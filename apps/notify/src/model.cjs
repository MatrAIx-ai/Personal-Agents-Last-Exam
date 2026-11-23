'use strict';
// Seed and state consistency. Core runs validateSeed after every load, tool call and event,
// so an invariant here can never be broken by a later write.
const {references:bound} = require('./domain-utils.cjs');
const {fail, ms} = require('./common.cjs');
const {validTimeZone} = require('./attention.cjs');

function timeline(record, label) {
  if (ms(record.created_at) > ms(record.updated_at)) fail('invalid_seed', label + ' timestamps are reversed.');
  let previous = record.created_at === undefined ? -Infinity : ms(record.created_at);
  for (const entry of record.history) {
    const at = ms(entry.at);
    if (!Number.isFinite(at) || at < previous || at > ms(record.updated_at)) fail('invalid_seed', 'Invalid history timeline for ' + label + '.');
    previous = at;
  }
  if (!record.history.length || previous !== ms(record.updated_at)) fail('invalid_seed', label + ' history must include the last update.');
}

function pushSender(ctx, data, source) {
  const account = ctx.binding.accounts.find(a => a.app_id === source.app_id && a.account_id === source.account_id);
  if (!account || account.owner_person_id !== data.owner_person_id) {
    fail('permission_denied', 'A push sender must be an App account bound to the device owner.');
  }
}

function validateSeed(ctx, data) {
  bound(ctx, data);
  const device = data.device;
  if (!validTimeZone(device.timezone)) fail('invalid_seed', 'Device time zone is not a valid IANA zone.');
  if (new Set(device.focus.map(w => w.id)).size !== device.focus.length) fail('invalid_seed', 'Duplicate focus window ID.');
  timeline(device, 'Device');

  const ids = new Set(), reminders = new Map(), feed = new Map();
  for (const record of [...data.reminders, ...data.feed]) {
    if (ids.has(record.id) || record.account_id !== data.account_id) fail('invalid_seed', 'Duplicate ID or wrong record account.');
    ids.add(record.id);
    timeline(record, record.id);
  }
  data.reminders.forEach(r => reminders.set(r.id, r));
  data.feed.forEach(f => feed.set(f.id, f));

  for (const r of data.reminders) {
    if (r.anchor && ms(r.anchor.event_start) - r.anchor.minutes_before * 60000 !== ms(r.fire_at)) {
      fail('invalid_seed', 'A Calendar-anchored reminder must fire minutes_before its event start.');
    }
    const fired = r.status === 'delivered' || r.status === 'silenced';
    if (!fired && (r.fired_at !== null || r.feed_item_id !== null)) fail('invalid_seed', 'Only a fired reminder has a delivery time and feed item.');
    if (fired) {
      const item = feed.get(r.feed_item_id);
      if (!r.fired_at || ms(r.fired_at) < ms(r.fire_at)) fail('invalid_seed', 'A reminder cannot fire before its time.');
      if (!item || item.source.kind !== 'reminder' || item.source.reminder_id !== r.id || item.delivery !== r.status ||
          ms(item.arrived_at) !== ms(r.fired_at)) fail('invalid_seed', 'A fired reminder must have its matching feed item.');
    }
  }
  for (const f of data.feed) {
    if (f.source.kind === 'reminder') {
      if (reminders.get(f.source.reminder_id)?.feed_item_id !== f.id) fail('invalid_seed', 'Feed item points to a reminder that did not produce it.');
    } else pushSender(ctx, data, f.source);
    if (ms(f.arrived_at) < ms(f.created_at) || ms(f.arrived_at) > ms(f.updated_at)) fail('invalid_seed', 'Arrival time is outside the record timeline.');
    for (const key of ['read_at', 'dismissed_at']) {
      if (f[key] !== null && (ms(f[key]) < ms(f.arrived_at) || ms(f[key]) > ms(f.updated_at))) fail('invalid_seed', key + ' is outside the record timeline.');
    }
  }
}

// Calendar anchors are opaque references; Core checks them against Calendar fixtures when both are assembled.
function references(data) {
  return data.reminders.filter(r => r.anchor).map(r => ({app_id:'calendar', account_id:r.anchor.calendar_event_ref.account_id,
    object_id:r.anchor.calendar_event_ref.event_id}));
}

module.exports = {validateSeed, pushSender, records:data => [...data.reminders, ...data.feed],
  objects:data => [...data.reminders, ...data.feed].map(r => r.id), references, assetReferences:() => []};
