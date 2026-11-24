'use strict';
const {fail, references: ownerReferences} = require('./domain-utils.cjs');
const {validZone} = require('./time.cjs');
const {STEP_FREE_MODES} = require('./catalog.cjs');
const {notificationId, addDays, localDate} = require('./common.cjs');
const net = require('./network.cjs');
const cards = require('./cards.cjs');

const unique = (list, key, what) => {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item[key])) fail('invalid_seed', 'Duplicate ' + what + ' ID ' + item[key] + '.');
    seen.add(item[key]);
  }
  return seen;
};
const notAfter = (value, now, what) => { if (value && Date.parse(value) > Date.parse(now)) fail('invalid_seed', what + ' is dated after the current virtual time.'); };
const known = (set, id, what) => { if (!set.has(id)) fail('invalid_seed', 'Unknown ' + what + ' ' + id + '.'); };

function validateNetwork(data, now) {
  const stops = unique(data.stops, 'stop_id', 'stop'), nodes = unique(data.nodes, 'node_id', 'node');
  for (const n of data.nodes) known(stops, n.stop_id, 'stop');
  const pathways = unique(data.pathways, 'pathway_id', 'pathway'), facilities = unique(data.facilities, 'facility_id', 'facility');
  for (const p of data.pathways) {
    known(nodes, p.from, 'pathway node'); known(nodes, p.to, 'pathway node');
    if (p.facility_id) known(facilities, p.facility_id, 'facility');
  }
  for (const f of data.facilities) {
    known(stops, f.stop_id, 'stop'); f.pathway_ids.forEach(id => known(pathways, id, 'pathway'));
    f.history.forEach((h, i) => {
      if (i > 0 && h.seq <= f.history[i - 1].seq) fail('invalid_seed', 'Facility status sequence numbers increase.');
      notAfter(h.recorded_at, now, 'Facility status'); notAfter(h.since, h.recorded_at, 'Facility status since');
    });
  }
  const routes = unique(data.routes, 'route_id', 'route');
  unique(data.patterns, 'pattern_id', 'pattern');
  for (const p of data.patterns) {
    known(routes, p.route_id, 'route');
    p.stops.forEach((s, i) => { known(nodes, s.node_id, 'pattern node'); if (i > 0 && s.offset_min <= p.stops[i - 1].offset_min) fail('invalid_seed', 'Pattern offsets increase.'); });
  }
  // Trip IDs are unique on each kind of service day.
  const week = addDays(localDate(data, Date.parse(now)), 0);
  for (let i = 0; i < 7; i++) unique(net.tripsOn(data, addDays(week, i)), 'trip_id', 'trip');
  unique(data.places, 'place_id', 'place');
  for (const p of data.places) p.access.forEach(a => known(nodes, a.node_id, 'access node'));
  // A station marked step-free has a step-free path from an entrance to each platform (ignoring outages).
  for (const s of data.stops.filter(x => x.kind === 'station' && x.step_free)) {
    const mine = data.nodes.filter(n => n.stop_id === s.stop_id), start = mine.filter(n => n.kind === 'entrance').map(n => n.node_id), seen = new Set(start);
    for (let changed = true; changed;) {
      changed = false;
      for (const p of data.pathways.filter(x => STEP_FREE_MODES.includes(x.mode))) {
        for (const [a, b] of [[p.from, p.to], ...(p.bidirectional ? [[p.to, p.from]] : [])]) if (seen.has(a) && !seen.has(b)) { seen.add(b); changed = true; }
      }
    }
    for (const n of mine.filter(x => x.kind === 'platform')) if (!seen.has(n.node_id)) fail('invalid_seed', `${s.stop_id} is marked step-free but ${n.node_id} has no step-free path.`);
  }
}

// Called by Core at load, after each write and during each event (with ctx.virtual_now set to the event time).
function validateSeed(ctx, data) {
  ownerReferences(ctx, data);
  const now = ctx.virtual_now;
  if (!validZone(data.settings.time_zone)) fail('invalid_seed', 'Unknown network time zone.');
  validateNetwork(data, now);
  for (const s of data.stops.filter(x => x.external_ref)) {
    const r = s.external_ref;
    if (!ctx.binding.accounts.some(a => a.app_id === r.app_id && a.account_id === r.account_id) || !ctx.binding.objects?.[r.app_id]?.includes(r.object_id)) {
      fail('invalid_seed', 'Cross-App reference is not in the task binding.');
    }
  }
  unique(data.alerts, 'alert_id', 'alert');
  for (const a of data.alerts) a.versions.forEach((v, i) => {
    if (i > 0 && v.version <= a.versions[i - 1].version) fail('invalid_seed', 'Alert versions increase.');
    if ((i === 0) !== (v.msg_type === 'alert') || (i > 0 && a.versions[i - 1].msg_type === 'cancel')) fail('invalid_seed', 'Alert chains run alert, updates, cancel.');
    notAfter(v.issued_at, now, 'Alert version');
  });
  for (const u of data.trip_updates) { if (!net.tripById(data, u.trip_id)) fail('invalid_seed', 'Trip update for an unknown trip.'); notAfter(u.at, now, 'Trip update'); }
  const methods = unique(data.rider.payment_methods, 'payment_method_id', 'payment method');
  const cardIds = unique(data.cards, 'card_id', 'card');
  unique(data.ledger, 'entry_id', 'ledger entry');
  for (const e of data.ledger) {
    known(cardIds, e.card_id, 'card'); notAfter(e.at, now, 'Ledger entry'); notAfter(e.settled_at, now, 'Settlement');
    if (e.payment_method_id) known(methods, e.payment_method_id, 'payment method');
  }
  for (const c of data.cards) {
    if (c.replaces) known(cardIds, c.replaces, 'card'); if (c.replaced_by) known(cardIds, c.replaced_by, 'card');
    if ((c.status === 'blocked') !== Boolean(c.replaced_by)) fail('invalid_seed', 'A blocked card has a replacement, and only a blocked card.');
    if (c.balance_cents !== cards.balanceOf(data, c)) fail('invalid_seed', `Card ${c.card_id} balance does not reconcile with its ledger.`);
    if (c.autoreload) known(methods, c.autoreload.payment_method_id, 'payment method');
    notAfter(c.created_at, now, 'Card');
  }
  unique(data.taps, 'tap_id', 'tap');
  for (const t of data.taps) { known(cardIds, t.card_id, 'card'); notAfter(t.at, now, 'Tap'); }
  unique(data.passes, 'pass_id', 'pass');
  for (const p of data.passes) { known(cardIds, p.card_id, 'card'); notAfter(p.purchased_at, now, 'Pass'); }
  unique(data.applications, 'application_id', 'application');
  for (const a of data.applications) { known(cardIds, a.card_id, 'card'); notAfter(a.submitted_at, now, 'Application'); notAfter(a.decided_at, now, 'Decision'); }
  const saved = unique(data.saved, 'saved_id', 'saved item');
  for (const s of data.saved) notAfter(s.created_at, now, 'Saved item');
  unique(data.subscriptions, 'subscription_id', 'subscription');
  for (const s of data.subscriptions) {
    for (const h of s.history) notAfter(h.at, now, 'Subscription history');
    if (s.status !== 'deleted' && s.target.kind === 'commute') known(saved, s.target.id, 'saved commute');
    if (s.status !== 'deleted' && s.target.kind === 'card') known(cardIds, s.target.id, 'card');
  }
  unique(data.notifications, 'notification_id', 'notification');
  for (const n of data.notifications) {
    notAfter(n.created_at, now, 'Notification');
    if (n.acknowledged_at) notAfter(n.acknowledged_at, now, 'Acknowledgement');
    if (n.outcome) notAfter(n.outcome.recorded_at, now, 'Delivery outcome');
    if (n.notification_id !== notificationId(n.trigger_key)) fail('invalid_seed', 'Notification ID must derive from its trigger key.');
    if (n.recipient_person_id !== data.owner_person_id) fail('invalid_seed', 'Notifications go to the account owner.');
  }
  for (const e of [...data.ignored_events, ...data.redirects]) notAfter(e.at, now, 'Event record');
}

// Business records the account owns or the task loaded, and their IDs (the same set, as Core expects).
const KINDS = [['places', 'place_id'], ['stops', 'stop_id'], ['facilities', 'facility_id'], ['routes', 'route_id'], ['alerts', 'alert_id'], ['cards', 'card_id'],
  ['ledger', 'entry_id'], ['taps', 'tap_id'], ['passes', 'pass_id'], ['applications', 'application_id'], ['saved', 'saved_id'], ['subscriptions', 'subscription_id'],
  ['notifications', 'notification_id']];
module.exports = {
  validateSeed,
  records: data => KINDS.flatMap(([list]) => data[list]),
  objects: data => KINDS.flatMap(([list, key]) => data[list].map(x => x[key])),
  references: data => data.stops.filter(s => s.external_ref).map(s => s.external_ref)
};
