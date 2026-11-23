'use strict';
// Infra-applied events. Each handler observes the event's own `at` as ctx.virtual_now.
// The App never schedules itself: a runner decides when to fire a due reminder,
// Messaging delivers pushes, and the user harness reports the user's own device changes.
const c = require('./common.cjs');
const {quietAt} = require('./attention.cjs');
const {pushSender} = require('./model.cjs');

function feedItem(ctx, data, id, fields) {
  const quiet = quietAt(data.device, ctx.virtual_now);
  const item = {id, account_id:data.account_id, created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[],
    ...fields, arrived_at:ctx.virtual_now, delivery:quiet.quiet ? 'silenced' : 'delivered', read_at:null, dismissed_at:null};
  c.stamp(ctx, item, item.delivery, {reason:quiet.reason});
  data.feed.push(item);
  return item;
}

function fire(ctx, data, event) {
  const r = c.find(data.reminders, event.payload.reminder_id, 'Reminder');
  if (r.status === 'cancelled') {
    // Recorded no-op: the runner may still hold a stale due list.
    c.stamp(ctx, r, 'fire_skipped_cancelled');
    return data;
  }
  if (r.status !== 'scheduled') c.fail('already_fired', 'This reminder has already fired.');
  if (c.ms(ctx.virtual_now) < c.ms(r.fire_at)) c.fail('not_due', 'The reminder is not due until ' + r.fire_at + '.');
  const item = feedItem(ctx, data, c.nextId(data, 'feed'), {source:{kind:'reminder', reminder_id:r.id}, title:r.title,
    body:r.body, actionable:r.actionable, deep_link:null, sent_at:r.fire_at});
  r.status = item.delivery;
  r.fired_at = ctx.virtual_now;
  r.feed_item_id = item.id;
  c.stamp(ctx, r, r.status);
  return data;
}

function receive(ctx, data, event) {
  const {recipient_account_id, message} = event.payload;
  const push = message.data;
  if (recipient_account_id !== data.account_id || push.recipient.id !== data.account_id) c.fail('invalid_event', 'Wrong receiving account.');
  pushSender(ctx, data, push.source_object);
  if (data.feed.some(f => f.id === event.event_id) || data.reminders.some(r => r.id === event.event_id)) {
    c.fail('already_exists', 'Delivered record already exists.');
  }
  const source = {kind:'push', ...c.copy(push.source_object), message_id:message.id};
  feedItem(ctx, data, event.event_id, {source, title:push.content.title, body:push.content.body,
    actionable:push.content.actionable, deep_link:push.content.deep_link, sent_at:message.time || null});
  return data;
}

function applyEvent(ctx, data, event) {
  const op = event.operation;
  if (op === 'notify.reminder.fire') return fire(ctx, data, event);
  if (op === 'notify.receive') return receive(ctx, data, event);
  if (op === 'notify.focus.set') {
    data.device.focus = c.copy(event.payload.focus);
    c.stamp(ctx, data.device, 'focus_set', {windows:data.device.focus.length});
    return data;
  }
  if (op === 'notify.device.silence') {
    const until = event.payload.until;
    if (until !== null && c.ms(until) <= c.ms(ctx.virtual_now)) c.fail('invalid_event', 'Silence must end after it starts.');
    data.device.silence_until = until;
    c.stamp(ctx, data.device, until === null ? 'silence_cleared' : 'silenced');
    return data;
  }
  if (op === 'notify.feed.dismiss') {
    const f = c.find(data.feed, event.payload.feed_item_id, 'Notification');
    if (f.dismissed_at !== null) c.fail('invalid_state', 'Notification is already dismissed.');
    f.dismissed_at = ctx.virtual_now;
    c.stamp(ctx, f, 'dismissed');
    return data;
  }
  c.fail('invalid_event', 'Unsupported operation.');
}

module.exports = {applyEvent};
