'use strict';
// Infra-applied events. Each handler observes the event's own `at` as ctx.virtual_now.
// Waypoint never delivers by itself: the host publishes a transfer's message through Messaging
// and records the verified outcome here with waypoint.transfer.settle.
const c = require('./common.cjs');
const {receive} = require('./messaging.cjs');

function settle(ctx, data, payload) {
  const t = c.find(data.transfers, payload.transfer_id, 'Transfer');
  if (t.status !== 'pending') c.fail('invalid_state', 'This transfer is already ' + t.status + '.');
  if (c.ms(ctx.virtual_now) < c.ms(t.available_at)) c.fail('not_due', 'This transfer is released at ' + t.available_at + '.');
  if (payload.outcome === 'credited') {
    const r = payload.receipt;
    if (!r || payload.rejection) c.fail('invalid_event', 'A credited outcome carries the receiver receipt only.');
    if (r.target_app_id !== t.recipient.app_id || r.target_account_id !== t.recipient.account_id) c.fail('invalid_event', 'The receipt is from another account.');
    t.receipt = c.copy(r);
    t.status = 'completed';
  } else {
    if (!payload.rejection || payload.receipt) c.fail('invalid_event', 'A rejected outcome carries the rejection only.');
    // The refund is a separate ledger entry in the same transfer record; it is applied once.
    const row = c.post(ctx, data, {kind:'refund', points:t.base_points, description:'Refund of rejected ' + t.id,
      ref:{kind:t.kind === 'partner_transfer' ? 'transfer' : 'combine', id:t.id}});
    t.rejection = c.copy(payload.rejection);
    t.refund_ledger_id = row.id;
    t.status = 'rejected';
  }
  t.settled_at = ctx.virtual_now;
  c.stamp(ctx, t, t.status);
  return data;
}

function bonusStart(ctx, data, payload) {
  const b = payload.bonus;
  c.find(data.partners, b.partner_id, 'Partner');
  if (data.bonuses.some(x => x.id === b.id) || data.ledger.some(x => x.id === b.id) || data.transfers.some(x => x.id === b.id)) {
    c.fail('already_exists', 'Bonus ' + b.id + ' already exists.');
  }
  if (c.ms(b.starts_at) >= c.ms(b.ends_at) || c.ms(b.ends_at) <= c.ms(ctx.virtual_now)) c.fail('invalid_event', 'A bonus window must end after it starts and after now.');
  const bonus = {...c.copy(b), created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  c.stamp(ctx, bonus, 'bonus_announced', {partner_id:b.partner_id});
  data.bonuses.push(bonus);
  return data;
}

function bonusEnd(ctx, data, payload) {
  const b = c.find(data.bonuses, payload.bonus_id, 'Bonus'), now = c.ms(ctx.virtual_now);
  if (now <= c.ms(b.starts_at) || now >= c.ms(b.ends_at)) c.fail('invalid_state', 'Only a running bonus can end early.');
  b.ends_at = ctx.virtual_now;
  c.stamp(ctx, b, 'bonus_ended_early');
  return data;
}

function applyEvent(ctx, data, event) {
  const op = event.operation;
  if (op === 'waypoint.receive') return receive(ctx, data, event);
  if (op === 'waypoint.transfer.settle') return settle(ctx, data, event.payload);
  if (op === 'waypoint.bonus.start') return bonusStart(ctx, data, event.payload);
  if (op === 'waypoint.bonus.end') return bonusEnd(ctx, data, event.payload);
  c.fail('invalid_event', 'Unsupported operation.');
}

module.exports = {applyEvent};
