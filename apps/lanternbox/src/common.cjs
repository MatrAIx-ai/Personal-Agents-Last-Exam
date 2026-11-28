'use strict';
const {fail} = require('./util.cjs');
const APP = 'lanternbox';
const PREFIX = {profile: 'prof', history: 'hst', charge: 'chg', notification: 'ntf'};
function allIds(data) {
  return new Set([...data.profiles.map(p => p.profile_id), ...data.history.map(h => h.history_id), ...data.charges.map(c => c.charge_id), ...data.notifications.map(n => n.notification_id),
    ...data.devices.map(x => x.device_id), ...data.titles.map(t => t.title_id)]);
}
// Records created during a run get <prefix>-r<n>, counted per kind in commit order; an ID already in use is skipped.
function nextId(data, kind) {
  const ids = allIds(data);
  let id;
  do { data.counters[kind] += 1; id = PREFIX[kind] + '-r' + data.counters[kind]; } while (ids.has(id));
  return id;
}
function record(ctx, data, actor, action, fields = {}) {
  data.activity.push({seq: data.activity.length + 1, at: ctx.virtual_now, actor, action, object_id: null, profile_id: null, request_id: null, event_id: null, replaced: null, removed: null, ...fields});
}
function notify(ctx, data, kind, text, refs = {}) {
  data.notifications.push({notification_id: nextId(data, 'notification'), kind, at: ctx.virtual_now, profile_id: null, title_id: null, playable_id: null, device_id: null, charge_id: null, text, ...refs});
}
module.exports = {APP, fail, allIds, nextId, record, notify};
