'use strict';
// Statuses that fall due with time. Infra moves the clock with env.advance_time, which runs no App code,
// so reads derive these on a copy, and every write or event stores them before it changes anything else.
// Each derived change is stamped with the time it fell due, so the result does not depend on when it is stored.
const {localDate, zoneOf, addDays, instantOf, render} = require('./common.cjs');
const {allocate} = require('./billing.cjs');
const {POLICY} = require('./catalog.cjs');

function materialize(data, now) {
  const t = Date.parse(now);
  const at = (date, premiseId) => render(instantOf(date, '00:00', zoneOf(data, premiseId)), zoneOf(data, premiseId));
  for (const o of data.orders.filter(x => x.status === 'scheduled' && x.needs === 'none' && x.type !== 'temporary_internet')) {
    const today = localDate(t, zoneOf(data, o.premise_id));
    const service = data.services.find(s => s.premise_id === o.premise_id && s.service_type === o.service_type);
    // A start date is the first day of service; a stop date is the last (until 23:59 local).
    if (o.type === 'start' && today >= o.date) {
      const when = at(o.date, o.premise_id);
      o.status = 'effective'; o.history.push({at: when, action: 'effective'});
      if (service && service.status === 'pending_start') { service.status = 'active'; service.activated_at = service.activated_at || when; }
    }
    if (o.type === 'stop' && today > o.date) {
      o.status = 'effective'; o.history.push({at: at(addDays(o.date, 1), o.premise_id), action: 'effective'});
      if (service) service.status = 'stopped';
    }
  }
  // A hotspot loan is effective from its first day.
  for (const o of data.orders.filter(x => x.status === 'scheduled' && x.type === 'temporary_internet')) {
    if (localDate(t, zoneOf(data, o.premise_id)) >= o.temp.from) { o.status = 'effective'; o.history.push({at: at(o.temp.from, o.premise_id), action: 'effective'}); }
  }
  // A stopped internet service starts its gateway's 30-day return window.
  for (const s of data.services.filter(x => x.service_type === 'internet' && x.status === 'stopped' && x.stop_date)) {
    for (const e of data.equipment.filter(x => x.kind === 'gateway' && x.premise_id === s.premise_id && x.status !== 'returned')) {
      if (!e.return_due) e.return_due = addDays(s.stop_date, POLICY.gateway_return_days);
      if (e.status !== 'return_due') e.status = 'return_due';
    }
  }
  // A hotspot is due back once its loan has ended.
  for (const e of data.equipment.filter(x => x.kind === 'hotspot' && ['delivered', 'in_use'].includes(x.status))) {
    const loan = data.orders.find(o => o.order_id === e.order_id);
    if (loan && localDate(t, zoneOf(data, e.premise_id)) > loan.temp.to) e.status = 'return_due';
  }
  for (const n of data.notifications) if (n.status === 'held_quiet_hours' && n.release_at && t >= Date.parse(n.release_at)) n.status = 'pending_delivery';
  // Autopay: from its date, a scheduled payment is pending for what is still unpaid, or skipped.
  for (const p of data.payments.filter(x => x.status === 'scheduled')) {
    const bill = data.bills.find(b => b.bill_id === p.autopay_bill_id), zone = zoneOf(data, bill.premise_id);
    if (localDate(t, zone) < p.scheduled_for) continue;
    const remaining = bill.total_cents - allocate(data, {pending: true, until: instantOf(p.scheduled_for, '00:00', zone)})[bill.bill_id];
    if (remaining > 0) { p.status = 'pending'; p.amount_cents = remaining; }
    else { p.status = 'skipped'; p.resolved_at = at(p.scheduled_for, bill.premise_id); }
  }
  return data;
}

module.exports = {materialize};
