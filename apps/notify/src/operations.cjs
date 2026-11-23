'use strict';
// Agent tools. Reminders are only scheduled here; delivery happens when Infra
// applies notify.reminder.fire at the reminder's time (see events.cjs).
const c = require('./common.cjs');
const {quietAt} = require('./attention.cjs');

const ANCHOR_KEYS = ['calendar_account_id', 'calendar_event_id', 'event_start', 'minutes_before'];
function anchorFrom(args) {
  const given = ANCHOR_KEYS.filter(k => args[k] !== undefined).length;
  if (!given) return null;
  if (given < ANCHOR_KEYS.length) c.fail('invalid_arguments', 'Give all of ' + ANCHOR_KEYS.join(', ') + ' to anchor to a Calendar event.');
  return {calendar_event_ref:{app_id:'calendar', account_id:args.calendar_account_id, event_id:args.calendar_event_id},
    event_start:args.event_start, minutes_before:args.minutes_before};
}

function anchoredTime(anchor) {
  return c.shift(anchor.event_start, -anchor.minutes_before * 60000);
}

function future(ctx, fireAt) {
  if (c.ms(fireAt) <= c.ms(ctx.virtual_now)) c.fail('invalid_time', 'The reminder time has already passed.');
  return fireAt;
}

function pending(data, id) {
  const r = c.find(data.reminders, id, 'Reminder');
  if (r.status !== 'scheduled') c.fail('invalid_state', 'Only a reminder that has not fired or been cancelled can change.');
  return r;
}

function create(ctx, data, args) {
  const anchor = anchorFrom(args);
  if ((args.fire_at === undefined) === (anchor === null)) c.fail('invalid_arguments', 'Give either fire_at or a Calendar anchor, not both.');
  const fireAt = future(ctx, anchor ? anchoredTime(anchor) : args.fire_at);
  const r = {id:c.nextId(data, 'reminder'), account_id:data.account_id, created_at:ctx.virtual_now, updated_at:ctx.virtual_now,
    history:[], title:args.title, body:args.body ?? '', fire_at:fireAt, anchor, actionable:args.actionable ?? false,
    status:'scheduled', fired_at:null, feed_item_id:null};
  c.stamp(ctx, r, 'scheduled');
  data.reminders.push(r);
  return {id:r.id, fire_at:r.fire_at};
}

function update(ctx, data, args) {
  const r = pending(data, args.id), patch = args.patch, anchor = anchorFrom(patch);
  if (!Object.keys(patch).length) c.fail('invalid_arguments', 'Patch must contain a field.');
  if (patch.fire_at !== undefined && anchor) c.fail('invalid_arguments', 'Give either fire_at or a Calendar anchor, not both.');
  for (const key of ['title', 'body', 'actionable']) if (patch[key] !== undefined) r[key] = patch[key];
  if (anchor) { r.anchor = anchor; r.fire_at = future(ctx, anchoredTime(anchor)); }
  else if (patch.fire_at !== undefined) { r.anchor = null; r.fire_at = future(ctx, patch.fire_at); }
  c.stamp(ctx, r, 'updated', {fields:Object.keys(patch)});
  return {id:r.id, fire_at:r.fire_at};
}

function handleTool(ctx, data, name, args) {
  if (name === 'notify.reminder.list') {
    const items = data.reminders.filter(r => (!args.status || r.status === args.status) &&
      (!args.from || c.ms(r.fire_at) >= c.ms(args.from)) && (!args.to || c.ms(r.fire_at) < c.ms(args.to)))
      .sort((a, b) => c.ms(a.fire_at) - c.ms(b.fire_at) || a.id.localeCompare(b.id));
    return {data, result:{items:c.copy(items)}};
  }
  if (name === 'notify.reminder.get') return {data, result:{item:c.copy(c.find(data.reminders, args.id, 'Reminder'))}};
  if (name === 'notify.feed.list') {
    const items = data.feed.filter(f => (args.include_dismissed || f.dismissed_at === null) &&
      (!args.unread_only || f.read_at === null) && (!args.since || c.ms(f.arrived_at) >= c.ms(args.since)))
      .sort((a, b) => c.ms(b.arrived_at) - c.ms(a.arrived_at) || b.id.localeCompare(a.id));
    return {data, result:{items:c.copy(items)}};
  }
  if (name === 'notify.focus.get') {
    const q = quietAt(data.device, ctx.virtual_now);
    return {data, result:{device:c.copy(data.device), quiet_now:q.quiet, quiet_reason:q.reason, focus_id:q.focus_id}};
  }
  if (name === 'notify.reminder.create') return {data, result:create(ctx, data, args)};
  if (name === 'notify.reminder.update') return {data, result:update(ctx, data, args)};
  if (name === 'notify.reminder.cancel') {
    const r = pending(data, args.id);
    r.status = 'cancelled';
    c.stamp(ctx, r, 'cancelled');
    return {data, result:{id:r.id}};
  }
  if (name === 'notify.feed.mark_read') {
    const f = c.find(data.feed, args.id, 'Notification');
    if (f.read_at === null) f.read_at = ctx.virtual_now;
    c.stamp(ctx, f, 'marked_read');
    return {data, result:{id:f.id}};
  }
  c.fail('unknown_tool', 'Unknown notify operation.');
}

module.exports = {handleTool};
