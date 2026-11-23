'use strict';
const {fail, localDate, addDays, daysBetween, daysInMonth, nextId, money, zoneOf, instantOf} = require('./common.cjs');
// Last millisecond of a local date.
const endOf = (date, zone) => instantOf(addDays(date, 1), '00:00', zone) - 1;
const {TARIFFS, PLANS, FEES, POLICY} = require('./catalog.cjs');

const counting = (p, pending) => p.status === 'settled' || (pending && p.status === 'pending');
// What is owed, as pieces ordered by due date: a bill is one piece, or, once it has an arrangement, the part
// already paid at approval plus one piece per installment. Payments fill pieces in that order, so a current
// bill is paid before installments that are not yet due, and installments are paid earliest first.
function pieces(data) {
  const out = [];
  for (const b of data.bills) {
    const a = data.arrangements.find(x => x.bill_id === b.bill_id);
    if (!a) { out.push({bill_id: b.bill_id, due: b.due_date, closed: b.closed_at, amount: Math.max(0, b.total_cents)}); continue; }
    const planned = a.installments.reduce((s, i) => s + i.amount_cents, 0);
    out.push({bill_id: b.bill_id, due: b.due_date, closed: b.closed_at, amount: Math.max(0, b.total_cents - planned)});
    a.installments.forEach((i, k) => out.push({bill_id: b.bill_id, due: i.due_date, closed: b.closed_at, amount: i.amount_cents, installment: k}));
  }
  return out.sort((x, y) => x.due.localeCompare(y.due) || Date.parse(x.closed) - Date.parse(y.closed) || (x.installment ?? -1) - (y.installment ?? -1));
}
// With `pending`, a payment counts from its creation time unless returned (late-fee and arrangement rules);
// without it only settled payments count (bill status). Returns paid cents per bill and per piece.
function allocation(data, {pending = false, until = null} = {}) {
  const paid = Object.fromEntries(data.bills.map(b => [b.bill_id, 0])), list = pieces(data);
  let pool = data.payments.filter(p => counting(p, pending) && (!until || Date.parse(p.created_at) <= until))
    .reduce((s, p) => s + p.amount_cents, 0);
  for (const piece of list) { piece.paid = Math.min(pool, piece.amount); pool -= piece.paid; paid[piece.bill_id] += piece.paid; }
  return {paid, pieces: list};
}
const allocate = (data, options) => allocation(data, options).paid;
function billStatus(data, bill, now) {
  const paid = allocate(data)[bill.bill_id];
  if (paid >= bill.total_cents) return 'paid';
  return localDate(now, zoneOf(data, bill.premise_id)) > bill.due_date ? 'past_due' : 'open';
}
// An arrangement is completed when its bill is paid, and defaulted when an installment is still unpaid
// 5 days after its due date (payments count from creation unless returned).
function arrangementStatus(data, a, now) {
  const bill = data.bills.find(b => b.bill_id === a.bill_id), zone = zoneOf(data, bill.premise_id);
  if (billStatus(data, bill, now) === 'paid') return 'completed';
  for (const [k, i] of a.installments.entries()) {
    const deadline = addDays(i.due_date, POLICY.late_grace_days);
    if (localDate(now, zone) <= deadline) continue;
    const piece = allocation(data, {pending: true, until: endOf(deadline, zone)}).pieces.find(x => x.bill_id === a.bill_id && x.installment === k);
    if (piece.paid < piece.amount) return 'defaulted';
  }
  return 'active';
}
// Late payments in the past 12 months: seeded history plus bills still not covered at the end of their due date.
function lateCount(data, now) {
  const t = Date.parse(now), year = 365 * 86400e3;
  let n = data.customer.late_payments.filter(x => t - Date.parse(x) <= year && Date.parse(x) <= t).length;
  for (const b of data.bills) {
    const zone = zoneOf(data, b.premise_id), end = endOf(b.due_date, zone);
    if (localDate(t, zone) <= b.due_date || t - end > year) continue;
    if (allocate(data, {pending: true, until: end})[b.bill_id] < b.total_cents) n++;
  }
  return n;
}

// A pending charge or credit; `ref` is the object it is for (one charge per kind and object where it applies).
function charge(data, premiseId, kind, description, amount, at, ref) {
  const c = {charge_id: nextId(data.charges, 'charge_id', 'ch'), premise_id: premiseId, kind, ref, description, amount_cents: amount, created_at: at, billed_in: null};
  data.charges.push(c);
  return c;
}

const SERVED = ['active', 'pending_start', 'pending_stop'];
const served = (data, premiseId) => data.services.some(s => s.premise_id === premiseId && SERVED.includes(s.status));
const charged = (data, kind, ref) => data.charges.some(c => c.kind === kind && c.ref === ref);
// The premise for an account-level charge (a returned payment): the latest bill's premise if it still has
// service, else any premise with service, else the latest bill's premise.
function accountPremise(data) {
  const last = data.bills.at(-1), live = data.services.find(s => SERVED.includes(s.status));
  return last && served(data, last.premise_id) ? last.premise_id : live ? live.premise_id : last ? last.premise_id : data.services[0]?.premise_id || data.premises[0].premise_id;
}

// billing.cycle_closed: Homegrid computes the bill for one premise from usage and its own records. Fees and
// charges for premises that no longer have any service (for example after a move) go on this bill too,
// since those premises will not bill again.
function closeCycle(data, payload, at) {
  if (data.bills.some(b => b.bill_id === payload.bill_id)) fail('invalid_event', 'Bill ID already exists.');
  const usageIds = Object.keys(payload.usage), services = usageIds.map(id => data.services.find(s => s.service_id === id));
  if (services.some(s => !s)) fail('invalid_event', 'Usage names an unknown service.');
  // A bill without metered usage (for example a final bill after a move) names its premise.
  const premises = new Set(services.map(s => s.premise_id));
  if (payload.premise_id) { if (!data.premises.some(p => p.premise_id === payload.premise_id)) fail('invalid_event', 'Unknown premise.'); premises.add(payload.premise_id); }
  if (premises.size !== 1) fail('invalid_event', 'One bill covers one premise.');
  const premiseId = [...premises][0], zone = zoneOf(data, premiseId), {from, to} = payload.period;
  if (from > to || localDate(at, zone) < to) fail('invalid_event', 'The period must have ended.');
  if (data.bills.some(b => b.premise_id === premiseId && !(b.period.to < from || b.period.from > to))) fail('invalid_event', 'The cycle overlaps an existing bill.');
  const lines = [];
  for (const s of services) {
    const u = payload.usage[s.service_id], t = TARIFFS[s.service_type];
    if (!t) fail('invalid_event', 'Usage is only billed for electricity and water.');
    const qty = u[t.unit];
    if (typeof qty !== 'number') fail('invalid_event', 'Usage must give ' + t.unit + '.');
    lines.push({kind: s.service_type, description: `${s.service_type} ${qty} ${t.unit}`, amount_cents: Math.round(qty * t.per_unit_cents) + t.customer_charge_cents});
  }
  // Internet: days active in the period, prorated by the days in the period's starting month.
  for (const s of data.services.filter(x => x.premise_id === premiseId && x.service_type === 'internet' && x.activated_at)) {
    const start = [from, localDate(s.activated_at, zone)].sort().pop(), end = [to, s.stop_date || to].sort()[0];
    const days = daysBetween(start, end) + 1;
    if (days <= 0) continue;
    const plan = PLANS.find(p => p.plan_id === s.plan_id);
    const amount = days >= daysInMonth(from) ? plan.monthly_cents : Math.round(days * plan.monthly_cents / daysInMonth(from));
    lines.push({kind: 'internet', description: `${plan.name}, ${days} days`, amount_cents: amount});
    // Outage credits: internet outages of 24 h or more, credited once.
    for (const o of data.outages.filter(x => x.service_type === 'internet' && x.premise_ids.includes(premiseId))) {
      const started = o.versions.find(v => v.status === 'started'), restored = o.versions.find(v => v.status === 'restored');
      if (!started || !restored || charged(data, 'outage_credit', o.outage_id)) continue;
      const hours = (Date.parse(restored.at) - Date.parse(started.at)) / 3600e3;
      if (hours < POLICY.outage_credit_hours) continue;
      const startedDays = Math.ceil(hours / 24), month = localDate(started.at, zone);
      charge(data, premiseId, 'outage_credit', `Outage credit for ${o.outage_id}`, -Math.round(startedDays * plan.monthly_cents / daysInMonth(month)), at, o.outage_id);
    }
  }
  const closeDate = localDate(at, zone), covered = new Set([premiseId, ...data.premises.map(p => p.premise_id).filter(id => !served(data, id))]);
  // Unreturned equipment past its deadline, charged once. Only equipment the customer received counts, and a
  // return counts at its returned_received time, only on or before the deadline.
  for (const e of data.equipment.filter(x => covered.has(x.premise_id) && x.return_due && x.return_due < closeDate &&
      (['delivered', 'in_use', 'return_due'].includes(x.status) || (x.status === 'returned' && localDate(x.returned_at, zone) > x.return_due)))) {
    if (charged(data, 'unreturned_' + e.kind, e.equipment_id)) continue;
    charge(data, e.premise_id, 'unreturned_' + e.kind, `Unreturned ${e.kind} ${e.equipment_id}`, e.kind === 'gateway' ? FEES.unreturned_gateway : FEES.unreturned_hotspot, at, e.equipment_id);
  }
  // Late fee: 1.5% of an earlier bill's balance still unpaid 5 days after its due date, charged once.
  for (const b of data.bills.filter(x => covered.has(x.premise_id))) {
    const deadline = addDays(b.due_date, POLICY.late_grace_days);
    if (closeDate <= deadline) continue;
    // A plan that is active or completed covers the bill; after a default the remaining balance is charged.
    const plan = data.arrangements.find(a => a.bill_id === b.bill_id), state = plan && arrangementStatus(data, plan, at);
    if (state === 'active' || state === 'completed') continue;
    const unpaid = b.total_cents - allocate(data, {pending: true, until: state === 'defaulted' ? Date.parse(at) : endOf(deadline, zone)})[b.bill_id];
    if (unpaid <= 0) continue;
    if (charged(data, 'late_fee', b.bill_id)) continue;
    charge(data, b.premise_id, 'late_fee', `Late fee on ${b.bill_id} (1.5% of ${money(unpaid)})`, Math.round(unpaid * FEES.late_fee_rate), at, b.bill_id);
  }
  for (const c of data.charges.filter(x => covered.has(x.premise_id) && !x.billed_in && Date.parse(x.created_at) <= Date.parse(at))) {
    lines.push({kind: c.kind, description: c.description, amount_cents: c.amount_cents});
    c.billed_in = payload.bill_id;
  }
  // Prior balance: what earlier bills still owe at close (settled payments only). Shown for information;
  // each bill is paid on its own lines, so it is not added to this bill's total.
  const settled = allocate(data), prior = data.bills.reduce((sum, b) => sum + Math.max(0, b.total_cents - settled[b.bill_id]), 0);
  const bill = {bill_id: payload.bill_id, premise_id: premiseId, period: {from, to}, closed_at: at, due_date: addDays(closeDate, POLICY.bill_due_days),
    usage: JSON.parse(JSON.stringify(payload.usage)), prior_balance_cents: prior, lines, total_cents: lines.reduce((s, l) => s + l.amount_cents, 0)};
  data.bills.push(bill);
  if (data.autopay.payment_method_id && bill.total_cents > 0) {
    data.payments.push({payment_id: 'py-auto-' + bill.bill_id, amount_cents: bill.total_cents, payment_method_id: data.autopay.payment_method_id,
      created_at: at, scheduled_for: bill.due_date, autopay_bill_id: bill.bill_id, status: 'scheduled', resolved_at: null});
  }
  return bill;
}

module.exports = {endOf, allocate, lateCount, billStatus, arrangementStatus, charge, accountPremise, closeCycle};
