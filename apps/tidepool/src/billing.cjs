'use strict';
// Billing derived from the stored plan timeline, adjustments and payment results at a given instant.
// Periods are calendar months from billing.anchor; nothing is stored when a period starts or ends.
const {fail, copy, instant, shift, addMonths, localDate, DAY} = require('./domain-utils.cjs');

const GRACE_DAYS = 7;
const plan = (data, id) => data.plans.find(p => p.plan_id === id);
const periodStart = (data, k) => addMonths(data.billing.anchor, k);
const invoiceId = (data, k) => 'inv-' + localDate(periodStart(data, k));

// Index of the period containing t; a clock before the anchor reads as the first period.
function periodIndex(data, t) {
  const at = instant(t), anchor = data.billing.anchor;
  if (at < instant(anchor)) return 0;
  const a = new Date(anchor), b = new Date(at);
  let k = Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - 1);
  while (instant(periodStart(data, k + 1)) <= at) k++;
  while (k > 0 && instant(periodStart(data, k)) > at) k--;
  return k;
}
// Inverse of invoiceId: the period index, or -1 if the ID is not on the billing calendar.
function invoiceIndex(data, id) {
  const m = /^inv-(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  if (!m) return -1;
  const first = localDate(data.billing.anchor);
  const k = (Number(m[1]) - Number(first.slice(0, 4))) * 12 + Number(m[2]) - Number(first.slice(5, 7));
  return k >= 0 && k <= 1200 && invoiceId(data, k) === id ? k : -1;
}
// The plan in effect at t: the last timeline entry that has started (the first entry before any has).
function planAt(data, t) {
  let current = data.billing.timeline[0];
  for (const entry of data.billing.timeline) if (instant(entry.from) <= instant(t)) current = entry;
  return plan(data, current.plan_id);
}
function scheduledChange(data, now) {
  const next = data.billing.timeline.find(e => instant(e.from) > instant(now));
  return next ? {plan_id: next.plan_id, effective_at: next.from} : null;
}
function invoice(data, k, now) {
  const id = invoiceId(data, k), start = periodStart(data, k), p = planAt(data, start);
  const lines = [{kind: 'plan', plan_id: p.plan_id, amount_cents: p.monthly_price_cents}];
  for (const a of data.billing.adjustments) if (a.invoice_id === id) lines.push({kind: 'upgrade_proration', plan_id: a.to_plan_id, amount_cents: a.amount_cents});
  const results = data.billing.payments.filter(x => x.invoice_id === id);
  const status = results.some(x => x.outcome === 'paid') ? 'paid' : results.length ? 'declined'
    : instant(start) <= instant(now) ? 'pending' : 'upcoming';
  return {invoice_id: id, period_start: start, period_end: periodStart(data, k + 1), plan_id: p.plan_id,
    amount_cents: lines.reduce((sum, l) => sum + l.amount_cents, 0), lines, status};
}
// A declined invoice that has not been paid puts the account in payment_due; the grace period runs
// 7 days from the invoice's first decline. The earliest such invoice decides the grace end.
function paymentDue(data, now) {
  let due = null;
  const ids = [...new Set(data.billing.payments.map(x => x.invoice_id))];
  for (const id of ids) {
    const results = data.billing.payments.filter(x => x.invoice_id === id);
    if (results.some(x => x.outcome === 'paid')) continue;
    const declinedAt = results.map(x => x.at).sort((a, b) => instant(a) - instant(b))[0];
    if (!due || instant(declinedAt) < instant(due.declined_at)) {
      const graceEnds = shift(declinedAt, GRACE_DAYS * DAY);
      due = {invoice_id: id, amount_cents: invoice(data, invoiceIndex(data, id), now).amount_cents, declined_at: declinedAt,
        grace_ends_at: graceEnds, grace_expired: instant(now) >= instant(graceEnds)};
    }
  }
  return due;
}
const graceExpired = (data, now) => paymentDue(data, now)?.grace_expired === true;
function view(data, now) {
  const k = periodIndex(data, now), due = paymentDue(data, now);
  return {status: due ? 'payment_due' : 'active', currency: data.billing.currency, period_start: periodStart(data, k),
    period_end: periodStart(data, k + 1), current_invoice: invoice(data, k, now), next_invoice: invoice(data, k + 1, now), payment_due: due};
}
const counted = data => data.members.filter(m => m.status === 'active').length + data.invitations.filter(i => i.status === 'open').length;
function slots(data, now) {
  const current = planAt(data, now), next = scheduledChange(data, now);
  const after = next ? plan(data, next.plan_id).max_members : null;
  const limit = Math.min(current.max_members, after ?? Infinity);
  const active = data.members.filter(m => m.status === 'active').length, open = data.invitations.filter(i => i.status === 'open').length;
  return {limit: current.max_members, active_members: active, open_invitations: open,
    available: Math.max(0, limit - active - open), limit_after_scheduled_change: after};
}

// One rule set for plan.preview_change and plan.confirm_change: classify the change, then apply it to
// a copy of billing; the quote's next invoice is read from that copy, so the two always agree.
function classify(data, now, toId) {
  const from = planAt(data, now), to = plan(data, toId), k = periodIndex(data, now);
  const start = instant(periodStart(data, k)), end = instant(periodStart(data, k + 1));
  const scheduled = scheduledChange(data, now), members = counted(data);
  // Choosing the plan in effect keeps it: a scheduled change is revoked; with none scheduled there is nothing to do.
  if (to.plan_id === from.plan_id) {
    return {from, to, k, change: 'none', blocked_by: scheduled ? null : 'same_plan', effective_at: now, proration_cents: 0, members, scheduled};
  }
  if (to.rank > from.rank) {
    const fraction = Math.min(1, Math.max(0, (end - instant(now)) / (end - start)));
    return {from, to, k, change: 'upgrade', blocked_by: paymentDue(data, now) ? 'payment_due' : null, effective_at: now,
      proration_cents: Math.round((to.monthly_price_cents - from.monthly_price_cents) * fraction), members, scheduled};
  }
  const blocked = members > to.max_members ? 'too_many_members' : scheduled?.plan_id === to.plan_id ? 'already_scheduled' : null;
  return {from, to, k, change: 'downgrade', blocked_by: blocked, effective_at: periodStart(data, k + 1), proration_cents: 0, members, scheduled};
}
function applyChange(data, now, c, newId) {
  const b = data.billing;
  b.timeline = b.timeline.filter(e => instant(e.from) <= instant(now));
  if (c.change === 'none') return;
  if (c.change === 'upgrade') {
    b.timeline.push({plan_id: c.to.plan_id, from: now, set_at: now, change: 'upgrade'});
    if (c.proration_cents > 0) {
      b.adjustments.push({adjustment_id: newId('adj'), invoice_id: invoiceId(data, c.k + 1), amount_cents: c.proration_cents,
        reason: 'upgrade_proration', from_plan_id: c.from.plan_id, to_plan_id: c.to.plan_id, created_at: now});
    }
  } else {
    b.timeline.push({plan_id: c.to.plan_id, from: c.effective_at, set_at: now, change: 'downgrade'});
  }
}
function quote(data, now, toId) {
  const c = classify(data, now, toId), trial = copy(data);
  if (c.blocked_by === null) applyChange(trial, now, c, prefix => prefix + '-preview');
  return {from_plan_id: c.from.plan_id, to_plan_id: c.to.plan_id, change: c.change, allowed: c.blocked_by === null,
    blocked_by: c.blocked_by, effective_at: c.effective_at, proration_cents: c.proration_cents, members_counted: c.members,
    new_limit: c.to.max_members, replaces_scheduled_change: c.scheduled,
    next_invoice: invoice(trial, c.k + 1, now)};
}
function confirm(data, now, toId, newId) {
  const c = classify(data, now, toId);
  if (c.blocked_by === 'payment_due') fail('payment_due', 'A declined payment is due; pay it before upgrading.');
  if (c.blocked_by === 'too_many_members') {
    fail('too_many_members', 'The ' + c.to.name + ' plan allows ' + c.to.max_members + ' members; the family has ' + c.members + ' members and open invitations.');
  }
  if (c.blocked_by === 'same_plan') fail('invalid_arguments', c.to.name + ' is already the plan in effect and no change is scheduled.');
  if (c.blocked_by === 'already_scheduled') fail('invalid_arguments', 'A change to ' + c.to.name + ' is already scheduled for ' + c.scheduled.effective_at + '.');
  applyChange(data, now, c, newId);
  return {change: c.change, replaced: c.scheduled, result: {change: c.change, plan_id: planAt(data, now).plan_id,
    effective_at: c.effective_at, proration_cents: c.proration_cents, scheduled_change: scheduledChange(data, now),
    revoked_change: c.change === 'none' ? c.scheduled : null, next_invoice: invoice(data, c.k + 1, now)}};
}
function revoke(data, now) {
  const scheduled = scheduledChange(data, now);
  if (!scheduled) fail('no_pending_change', 'No plan change is scheduled.');
  data.billing.timeline = data.billing.timeline.filter(e => instant(e.from) <= instant(now));
  return {revoked: scheduled, plan_id: planAt(data, now).plan_id};
}

module.exports = {GRACE_DAYS, plan, planAt, periodIndex, periodStart, invoiceId, invoiceIndex, invoice, scheduledChange, paymentDue,
  graceExpired, view, slots, counted, quote, confirm, revoke};
