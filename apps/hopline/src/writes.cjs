'use strict';
// Agent writes. They run on Core's copy after materialize().
const {fail, copy, stamp, nextId} = require('./common.cjs');
const {LIMITS} = require('./catalog.cjs');
const net = require('./network.cjs');
const cards = require('./cards.cjs');

const minutes = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const live = list => list.filter(s => s.status !== 'deleted');
function getSaved(data, id) {
  const s = data.saved.find(x => x.saved_id === id);
  if (!s) fail('saved_not_found', 'Saved place or commute does not exist.');
  return s;
}
function checkWindow(w, needed) {
  if (!w) { if (needed) fail('invalid_window', 'A window is required.'); return; }
  if (!w.days || !w.days.length || !w.start || !w.end || minutes(w.end) === minutes(w.start)) fail('invalid_window', 'A window needs days and different start and end times.');
}
function checkQuiet(q) {
  if (q && (!q.start || !q.end || q.start === q.end)) fail('invalid_window', 'Quiet hours need different start and end times.');
}
function refExists(data, ref) {
  if (!data.places.some(p => p.place_id === ref) && !data.stops.some(s => s.stop_id === ref)) fail('place_not_found', 'No place or stop with that ID.');
}

function addSaved(ctx, data, a) {
  if (data.saved.length >= LIMITS.saved) fail('saved_limit', 'At most 20 saved places and commutes.');
  const base = {saved_id: nextId(data.saved, 'saved_id', 'sv'), kind: a.kind, label: a.label, created_at: stamp(ctx, data)};
  if (a.kind === 'place') {
    if (!a.place_ref) fail('place_not_found', 'A saved place needs place_ref.');
    refExists(data, a.place_ref);
    data.saved.push({...base, place_ref: a.place_ref});
  } else {
    const from = getSaved(data, a.from_saved_id), to = getSaved(data, a.to_saved_id);
    if (from.kind !== 'place' || to.kind !== 'place') fail('saved_not_found', 'A commute runs between two saved places.');
    checkWindow(a.window && {days: a.days || [], ...a.window}, true);
    data.saved.push({...base, from_saved_id: from.saved_id, to_saved_id: to.saved_id, from_ref: from.place_ref, to_ref: to.place_ref,
      window: {days: [...new Set(a.days)].sort(), start: a.window.start, end: a.window.end}, step_free: !!a.step_free, max_walk_m: a.max_walk_m ?? 1200,
      max_transfers: a.max_transfers ?? 2, avoid_modes: a.avoid_modes || []});
  }
  return {saved_id: base.saved_id};
}
// A saved item is in use while a subscription targets it, or targets a commute that starts or ends at it.
function removeSaved(ctx, data, id) {
  const s = getSaved(data, id);
  const users = live(data.subscriptions).filter(sub => sub.target.kind === 'commute' &&
    (sub.target.id === id || [getSavedOrNull(data, sub.target.id)?.from_saved_id, getSavedOrNull(data, sub.target.id)?.to_saved_id].includes(id)));
  if (users.length) fail('saved_in_use', `Subscriptions refer to it: ${users.map(u => u.subscription_id).join(', ')}.`);
  data.saved = data.saved.filter(x => x !== s);
  return {saved_id: id};
}
const getSavedOrNull = (data, id) => data.saved.find(x => x.saved_id === id) || null;

function target(data, t) {
  if (t.kind === 'route' && !data.routes.some(r => r.route_id === t.id)) fail('route_not_found', 'Route does not exist.');
  if (t.kind === 'stop') net.stopOrFail(data, t.id);
  if (t.kind === 'facility' && !data.facilities.some(f => f.facility_id === t.id)) fail('unknown_facility', 'Facility does not exist.');
  if (t.kind === 'commute' && getSaved(data, t.id).kind !== 'commute') fail('saved_not_found', 'That saved item is not a commute.');
  if (t.kind === 'card') cards.live(data, t.id);
}
const FIELDS = ['window', 'delay_threshold_min', 'low_balance_cents', 'quiet_hours', 'urgent_override', 'delivery'];
function createSub(ctx, data, a) {
  if (live(data.subscriptions).length >= LIMITS.subscriptions) fail('subscription_limit', 'At most 25 subscriptions.');
  target(data, a.target);
  checkWindow(a.window, false);
  checkQuiet(a.quiet_hours);
  const now = stamp(ctx, data);
  const s = {subscription_id: nextId(data.subscriptions, 'subscription_id', 'sub'), target: copy(a.target), window: a.window ? {...a.window, days: [...new Set(a.window.days)].sort()} : null,
    delay_threshold_min: a.delay_threshold_min ?? (['route', 'stop', 'commute'].includes(a.target.kind) ? 10 : null),
    low_balance_cents: a.low_balance_cents ?? (a.target.kind === 'card' ? 500 : null), quiet_hours: a.quiet_hours ?? null, urgent_override: a.urgent_override ?? true,
    delivery: a.delivery || 'in_app', status: 'active', created_at: now, revision: 1, history: [{revision: 1, at: now, action: 'created', changes: {}}]};
  data.subscriptions.push(s);
  return {subscription_id: s.subscription_id};
}
function getSub(data, id) {
  const s = data.subscriptions.find(x => x.subscription_id === id && x.status !== 'deleted');
  if (!s) fail('subscription_not_found', 'Subscription does not exist.');
  return s;
}
function updateSub(ctx, data, a) {
  const s = getSub(data, a.subscription_id), changes = {};
  for (const k of [...FIELDS, 'status']) if (a[k] !== undefined) changes[k] = a[k];
  if (!Object.keys(changes).length) fail('invalid_window', 'Nothing to change.');
  if (changes.window !== undefined) checkWindow(changes.window, false);
  if (changes.quiet_hours !== undefined) checkQuiet(changes.quiet_hours);
  Object.assign(s, copy(changes));
  s.revision++; s.history.push({revision: s.revision, at: stamp(ctx, data), action: 'updated', changes: copy(changes)});
  return {subscription_id: s.subscription_id, revision: s.revision};
}
// A deleted subscription is kept as a tombstone with its revisions; it no longer counts or fires.
function deleteSub(ctx, data, id) {
  const s = getSub(data, id);
  s.status = 'deleted'; s.revision++; s.history.push({revision: s.revision, at: stamp(ctx, data), action: 'deleted', changes: {}});
  return {subscription_id: s.subscription_id};
}

function write(ctx, data, name, args) {
  switch (name) {
    case 'hopline.saved.add': return addSaved(ctx, data, args);
    case 'hopline.saved.remove': return removeSaved(ctx, data, args.saved_id);
    case 'hopline.subscriptions.create': return createSub(ctx, data, args);
    case 'hopline.subscriptions.update': return updateSub(ctx, data, args);
    case 'hopline.subscriptions.delete': return deleteSub(ctx, data, args.subscription_id);
    case 'hopline.notifications.acknowledge': {
      const n = data.notifications.find(x => x.notification_id === args.notification_id);
      if (!n) fail('notification_not_found', 'Notification does not exist.');
      if (!n.acknowledged_at) n.acknowledged_at = stamp(ctx, data);
      return {notification_id: n.notification_id, acknowledged_at: n.acknowledged_at};
    }
    case 'hopline.cards.add_value': return cards.addValue(ctx, data, args);
    case 'hopline.cards.set_autoreload': return cards.setAutoreload(ctx, data, args);
    case 'hopline.passes.purchase': return cards.purchasePass(ctx, data, args);
    case 'hopline.passes.cancel': return cards.cancelPass(ctx, data, args);
    case 'hopline.cards.report_lost': return cards.reportLost(ctx, data, args);
    case 'hopline.reduced_fare.apply': return cards.applyReduced(ctx, data, args);
    default: fail('unknown_tool', 'Unknown tool.');
  }
}

module.exports = {write};
