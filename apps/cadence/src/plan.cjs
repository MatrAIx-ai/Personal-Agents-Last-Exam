'use strict';
// Workflow 1: plan changes and cancellations as a proration preview followed by a confirmation.
const c = require('./common.cjs');
const {fail, copy, parse, money, credits} = c;

const effectiveDay = a => a.status === 'trial' ? a.trial_end : a.renewal_date;
const planFingerprint = data => {const a = data.account, m = c.paymentMethod(data, a.payment_method_id); return c.short(JSON.stringify([a.plan_id, a.status, a.renewal_date, a.trial_end, a.pending_change, m ? m.status : null]));};
function pendingMessage(data, a) {
  const change = a.pending_change;
  return 'A change is already scheduled for ' + c.formatter(data).dayLabel(change.effective_on) + ': ' + (change.action === 'cancel' ? 'the plan ends' : 'switch to ' + c.plan(data, change.plan_id).name) + '.';
}
function preview(ctx, data, args) {
  const nowMs = c.now(ctx), a = data.account, cur = c.activePlan(data), f = c.formatter(data);
  if (a.status === 'cancelled') fail('invalid_state', 'The plan is cancelled; there is nothing to change.');
  if (a.pending_change) fail('change_pending', pendingMessage(data, a));
  const effective = effectiveDay(a);
  let payload;
  if (args.action === 'cancel') {
    const renews = data.plans.find(p => p.kind === 'credits');
    payload = {action:'cancel', plan_id:null, effective_on:effective, charge_cents:0, credit_change:-cur.credits_per_period,
      note:a.status === 'trial' ? 'A trial can only be cancelled at its end, ' + f.dayLabel(effective) + '; it will then not renew into ' + (renews ? renews.name : 'a paid plan') + '.' : cur.name + ' stays active until ' + f.dayLabel(effective) + ' and does not renew after that.'};
  } else {
    if (!args.plan_id) fail('invalid_arguments', 'plan_id is required to change plans.');
    const target = data.plans.find(p => p.plan_id === args.plan_id);
    if (!target) fail('unknown_plan', 'Plan ' + args.plan_id + ' does not exist. Plans: ' + data.plans.filter(p => p.kind !== 'trial').map(p => p.plan_id).join(', ') + '.');
    if (target.plan_id === a.plan_id) fail('same_plan', 'You are already on ' + cur.name + '.');
    if (target.kind === 'trial') fail('invalid_arguments', 'A trial cannot be chosen as a plan.');
    const m = c.paymentMethod(data, a.payment_method_id);
    if (target.price_cents > 0 && (!m || m.status === 'declined')) fail('payment_declined', 'The payment method on file' + (m ? ' (' + m.brand + ' ending ' + m.last4 + ')' : '') + ' was declined; update it in Cadence before changing plans.');
    payload = {action:'change', plan_id:target.plan_id, effective_on:effective, charge_cents:target.price_cents, credit_change:target.credits_per_period - cur.credits_per_period,
      note:target.name + ' starts on ' + f.dayLabel(effective) + ' at ' + money(target.price_cents) + ' per ' + target.period_days + ' days with ' + credits(target.credits_per_period) + '; the charge posts on that date.'};
  }
  const pv = {preview_id:c.nextId(data, 'pv-plan'), kind:'plan', created_at:ctx.virtual_now, expires_at:c.iso(nowMs + c.minutes(data.settings.preview_ttl_minutes)), approved:false, fingerprint:planFingerprint(data), payload};
  data.previews.push(pv);
  c.log(ctx, c.PREFIX + 'plan_previewed', {preview_id:pv.preview_id});
  return {id:pv.preview_id, ...copy(payload), expires_at:pv.expires_at, approval_required:data.settings.require_user_confirmation};
}
function apply(ctx, data, args, action) {
  const pv = c.livePreview(ctx, data, args.id, 'plan'), a = data.account;
  if (pv.payload.action !== action) fail('invalid_arguments', 'Preview ' + pv.preview_id + ' prepares a ' + pv.payload.action + ', not a ' + action + '.');
  if (planFingerprint(data) !== pv.fingerprint) fail('preview_stale', 'The plan changed since preview ' + pv.preview_id + '. Request a new preview.');
  if (a.pending_change) fail('change_pending', pendingMessage(data, a));
  c.gate(data, pv, pv.preview_id, action === 'cancel' ? 'Cancelling the plan' : 'Changing the plan');
  a.pending_change = {action, plan_id:pv.payload.plan_id, effective_on:pv.payload.effective_on, requested_at:ctx.virtual_now};
  if (action === 'cancel') a.status = 'cancel_at_period_end';
  c.stamp(ctx, a, 'plan_id', action === 'cancel' ? 'cancellation_scheduled' : 'change_scheduled', pv.payload.note);
  c.dropPreview(data, pv.preview_id);
  return pv;
}
const change = (ctx, data, args) => {const pv = apply(ctx, data, args, 'change'); return {id:pv.payload.plan_id, preview_id:pv.preview_id, plan_id:pv.payload.plan_id, effective_on:pv.payload.effective_on, outcome:'scheduled'};};
const cancel = (ctx, data, args) => {const pv = apply(ctx, data, args, 'cancel'); return {id:data.account.plan_id, preview_id:pv.preview_id, effective_on:pv.payload.effective_on, outcome:'cancel_at_period_end'};};
module.exports = {preview, change, cancel};
