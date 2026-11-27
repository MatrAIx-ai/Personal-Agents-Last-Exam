'use strict';
// Events Infra applies through env.apply_event. The handler reads the event's time as now (Core sets ctx.virtual_now to it).
const c = require('./common.cjs');
const {fail, parse, credits, money} = c;

function account(data, id) {if (id !== data.account_id) fail('invalid_event', 'Account ' + id + ' is not this instance.'); return data.account;}
const HANDLERS = {
  'classes.cancelled_by_studio'(ctx, data, p) {
    const x = c.instance(data, p.class_instance_id);
    if (x.status !== 'scheduled') fail('invalid_event', 'Class ' + x.class_instance_id + ' is already cancelled.');
    x.status = 'cancelled'; x.cancellation_reason = p.reason;
    c.stamp(ctx, x, 'class_instance_id', 'cancelled_by_studio', p.reason);
    for (const r of data.reservations) if (r.class_instance_id === x.class_instance_id && r.status === 'booked') {
      const returned = r.credits_charged;
      r.status = 'cancelled_by_studio'; r.cancellation_reason = p.reason; data.account.credits_remaining += returned; r.credits_charged = 0;
      c.stamp(ctx, r, 'reservation_id', 'cancelled_by_studio', returned ? credits(returned) + ' returned' : 'No charge');
    }
    for (const e of data.waitlist) if (e.class_instance_id === x.class_instance_id && ['waiting', 'offered'].includes(e.status)) {e.status = 'expired'; c.stamp(ctx, e, 'waitlist_entry_id', 'class_cancelled');}
  },
  'classes.schedule_changed'(ctx, data, p) {
    const x = c.instance(data, p.class_instance_id);
    if (x.status !== 'scheduled') fail('invalid_event', 'Class ' + x.class_instance_id + ' is cancelled.');
    if (p.new_start === null && p.new_instructor_id === null) fail('invalid_event', 'A schedule change needs a new start or a new instructor.');
    const details = [];
    if (p.new_start !== null) {
      const delta = parse(p.new_start) - parse(x.start), end = c.iso(parse(x.end) + delta);
      const clash = data.class_instances.find(y => y !== x && y.studio_id === x.studio_id && y.room === x.room && y.status === 'scheduled' && c.overlap({start:p.new_start, end}, y));
      if (clash) fail('invalid_event', 'The new time overlaps ' + clash.class_instance_id + ' in the same room.');
      x.time_changed_from = x.start; x.start = p.new_start; x.end = end;
      details.push('moved to ' + c.formatter(data).stamp(parse(p.new_start)));
      for (const r of data.reservations) if (r.class_instance_id === x.class_instance_id && r.status === 'booked') {r.time_changed = true; c.stamp(ctx, r, 'reservation_id', 'time_changed', details[0]);}
    }
    if (p.new_instructor_id !== null) {
      const i = c.instructor(data, p.new_instructor_id);
      if (i.studio_id !== x.studio_id) fail('invalid_event', 'Instructor ' + i.instructor_id + ' teaches at another studio.');
      x.instructor_id = i.instructor_id; details.push('instructor ' + i.name);
    }
    c.stamp(ctx, x, 'class_instance_id', 'schedule_changed', details.join('; '));
  },
  'classes.capacity_changed'(ctx, data, p) {
    const x = c.instance(data, p.class_instance_id), held = x.external_bookings + c.myHeld(data, x.class_instance_id).length;
    if (p.capacity < held) fail('capacity_below_bookings', 'Class ' + x.class_instance_id + ' holds ' + held + ' bookings; capacity cannot drop to ' + p.capacity + '.');
    const before = x.capacity; x.capacity = p.capacity;
    c.stamp(ctx, x, 'class_instance_id', 'capacity_changed', before + ' to ' + p.capacity);
  },
  'waitlist.promoted'(ctx, data, p) {
    c.expireOffers(ctx, data);
    const e = c.entry(data, p.waitlist_entry_id), x = c.instance(data, e.class_instance_id);
    if (e.status !== 'waiting') fail('invalid_event', 'Waitlist entry ' + e.waitlist_entry_id + ' is ' + e.status + ', not waiting.');
    if (x.status !== 'scheduled') fail('invalid_event', 'Class ' + x.class_instance_id + ' is cancelled.');
    if (parse(p.offer_expires_at) <= c.now(ctx)) fail('invalid_event', 'The offer must expire after it is made.');
    if (c.spotsLeft(data, x) === 0) {if (x.external_bookings === 0) fail('invalid_event', 'No spot opened in class ' + x.class_instance_id + '.'); x.external_bookings -= 1;}   // the spot that opened is held for this offer
    e.status = 'offered'; e.offer = {offer_id:c.nextId(data, 'offer'), offered_at:ctx.virtual_now, offer_expires_at:p.offer_expires_at, approved:false};
    c.stamp(ctx, e, 'waitlist_entry_id', 'offered', 'Until ' + p.offer_expires_at);
  },
  'plan.renewed'(ctx, data, p) {
    const a = account(data, p.account_id);
    if (p.renewal_date <= a.renewal_date) fail('invalid_event', 'The next renewal date must follow the current one (' + a.renewal_date + ').');
    if (a.status === 'cancelled') fail('invalid_event', 'The plan is cancelled and does not renew.');
    if (a.pending_change && a.pending_change.action === 'cancel') {
      a.status = 'cancelled'; a.credits_remaining = 0; a.trial_end = null; a.pending_change = null; a.period_start = a.renewal_date; a.renewal_date = p.renewal_date;
      c.stamp(ctx, a, 'plan_id', 'cancelled', 'The plan ended at the period end and did not renew');
      return;
    }
    const target = c.plan(data, p.plan_id);
    if (target.kind === 'trial') fail('invalid_event', 'A renewal cannot start a trial.');
    if (a.pending_change && a.pending_change.plan_id !== p.plan_id) fail('invalid_event', 'The renewal names ' + p.plan_id + ' but the scheduled change is to ' + a.pending_change.plan_id + '.');
    if (!a.pending_change && a.status !== 'trial' && a.plan_id !== p.plan_id) fail('invalid_event', 'The renewal names ' + p.plan_id + ' but no change to it is scheduled.');
    const m = c.paymentMethod(data, a.payment_method_id);
    if (target.price_cents > 0 && (!m || m.status === 'declined')) fail('invalid_event', 'The renewal could not be charged: the payment method on file is declined or missing.');
    a.period_start = a.renewal_date; a.renewal_date = p.renewal_date; a.plan_id = target.plan_id; a.status = 'active'; a.credits_remaining = target.credits_per_period; a.trial_end = null; a.pending_change = null;
    data.receipts.push({receipt_id:c.nextId(data, 'rcpt'), at:ctx.virtual_now, kind:'renewal', amount_cents:target.price_cents, description:target.name + ', ' + a.period_start + ' to ' + c.addDays(a.renewal_date, -1), payment_method_id:m ? m.payment_method_id : null});
    c.stamp(ctx, a, 'plan_id', 'renewed', target.name + ' for ' + money(target.price_cents) + '; ' + credits(target.credits_per_period));
  },
  'plan.trial_ending'(ctx, data, p) {
    const a = account(data, p.account_id);
    if (a.status !== 'trial' || a.trial_end !== p.trial_end) fail('invalid_event', 'The account is not on a trial ending ' + p.trial_end + '.');
    a.trial_reminder_sent_at = ctx.virtual_now;
    c.stamp(ctx, a, 'plan_id', 'trial_reminder_sent', 'Trial ends ' + p.trial_end);
  },
  'account.session_expired'(ctx, data, p) {
    const a = account(data, p.account_id);
    if (a.signed_out) fail('invalid_event', 'The session is already expired.');
    a.signed_out = true; c.stamp(ctx, a, 'plan_id', 'session_expired');
  },
  'account.session_restored'(ctx, data, p) {
    const a = account(data, p.account_id);
    if (!a.signed_out) fail('invalid_event', 'The session is not expired.');
    a.signed_out = false; c.stamp(ctx, a, 'plan_id', 'session_restored');
  },
  'user.confirmed'(ctx, data, p) {
    const nowMs = c.now(ctx);
    if (p.preview_id !== undefined) {
      const pv = data.previews.find(x => x.preview_id === p.preview_id);
      if (!pv || nowMs > parse(pv.expires_at)) fail('unknown_target', 'No live preview ' + p.preview_id + '.');
      pv.approved = true; c.log(ctx, c.PREFIX + 'user_confirmed', {preview_id:pv.preview_id}); return;
    }
    const e = data.waitlist.find(x => x.offer && x.offer.offer_id === p.offer_id && x.status === 'offered' && parse(x.offer.offer_expires_at) >= nowMs);
    if (!e) fail('unknown_target', 'No open offer ' + p.offer_id + '.');
    e.offer.approved = true; c.log(ctx, c.PREFIX + 'user_confirmed', {offer_id:p.offer_id});
  }
};
function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  handler(ctx, data, event.payload);
  c.log(ctx, c.PREFIX + 'event_applied', {event_id:event.event_id, operation:event.operation});
  return data;
}
module.exports = {applyEvent};
