'use strict';
// Activity rows (one per committed Agent write and per applied event) and notifications (written
// only by event handlers, once per event, at the event's time).
const c = require('./common.cjs');
const {copy} = c;

function activity(data, row) {
  const seq = data.activity.length ? data.activity.at(-1).seq + 1 : 1;
  data.activity.push({seq, at: row.at, actor: row.actor, by: row.by, action: row.action, object_id: row.object_id, request_id: row.request_id, event_id: row.event_id});
}

function notify(data, {at, kind, event_id, by, object_id, title, body}) {
  const id = c.nextId('ntf-', data.notifications.map(n => n.id));
  data.notifications.push({id, at, kind, event_id, by, object_id, title, body});
  return id;
}

function list(ctx, data, args) {
  const zone = data.household.time_zone;
  for (const d of [args.start, args.end]) if (d !== undefined && !c.isDate(d)) c.fail('invalid_arguments', `${d} is not a calendar date.`);
  if (args.start && args.end && args.end < args.start) c.fail('invalid_window', `The window ends (${args.end}) before it starts (${args.start}).`);
  const rows = data.notifications.filter(n => {
    const day = c.localDate(n.at, zone);
    return (!args.start || day >= args.start) && (!args.end || day <= args.end) && (!args.kind || n.kind === args.kind);
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  return {notifications: copy(rows)};
}

module.exports = {activity, notify, list};
