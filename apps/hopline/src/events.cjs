'use strict';
// Infra-applied events. Tasks choose content and timing; Hopline defines each event's effect.
// Core exposes the event's `at` as ctx.virtual_now while this runs, and rejects backwards time.
const {fail, copy, log, stamp, render, zone, money, checkDates} = require('./common.cjs');
const {EFFECTS} = require('./catalog.cjs');
const net = require('./network.cjs');
const cards = require('./cards.cjs');
const subs = require('./subs.cjs');
const {materialize} = require('./derive.cjs');

// A moot event commits as a no-op; the reason is kept in Hopline's own records.
class Moot { constructor(reason) { this.reason = reason; } }
const moot = reason => { throw new Moot(reason); };
const notLater = (ctx, t, what) => { if (Date.parse(t) > Date.parse(ctx.virtual_now)) fail('invalid_event', what + ' is later than the event time.'); };
// An event naming a replaced card goes to its active replacement; the redirection is recorded.
function redirect(ctx, data, event, id) {
  const c = cards.current(data, id);
  if (c.card_id !== id) data.redirects.push({event_id: event.event_id, at: stamp(ctx, data), operation: event.operation, from_card_id: id, to_card_id: c.card_id});
  return c;
}

function alertPublished(ctx, data, p) {
  if (p.issued_at) notLater(ctx, p.issued_at, 'issued_at');
  let a = data.alerts.find(x => x.alert_id === p.alert_id);
  if (p.msg_type === 'alert') {
    if (a) fail('stale_alert_version', 'This alert already exists; send an update.');
    if (!p.effect || !p.informed || !p.active_periods || !p.header) fail('invalid_event', 'A new alert needs effect, informed entities, active periods and a header.');
    a = {alert_id: p.alert_id, versions: []};
  } else {
    if (!a) fail('alert_reference_unknown', 'The alert being updated or cancelled does not exist.');
    const last = net.latest(a);
    if (last.msg_type === 'cancel') fail('stale_alert_version', 'The alert is already cancelled.');
    if (p.version <= last.version) fail('stale_alert_version', 'The version must be greater than ' + last.version + '.');
    if (p.references && !p.references.some(r => r.alert_id === a.alert_id && r.version === last.version)) fail('alert_reference_unknown', 'References must name the latest version.');
  }
  const prev = a.versions.at(-1) || {};
  const informed = p.informed ? {route_ids: p.informed.route_ids || [], stop_ids: p.informed.stop_ids || [], facility_ids: p.informed.facility_ids || []} : copy(prev.informed);
  const v = {version: p.version, msg_type: p.msg_type, cause: p.cause || prev.cause || 'other', effect: p.effect || prev.effect, informed,
    replacement_stop_id: p.replacement_stop_id ?? prev.replacement_stop_id ?? null,
    active_periods: p.active_periods ? p.active_periods.map(x => ({start: x.start, end: x.end ?? null})) : copy(prev.active_periods),
    header: p.header || prev.header, description: p.description ?? prev.description ?? null, issued_at: render(Date.parse(p.issued_at || ctx.virtual_now), zone(data))};
  if (!EFFECTS.includes(v.effect)) fail('invalid_event', 'Unknown effect.');
  for (const id of v.informed.route_ids) if (!data.routes.some(r => r.route_id === id)) fail('invalid_event', 'Unknown route ' + id + '.');
  for (const id of v.informed.stop_ids) if (!data.stops.some(s => s.stop_id === id)) fail('invalid_event', 'Unknown stop ' + id + '.');
  for (const id of v.informed.facility_ids) if (!data.facilities.some(f => f.facility_id === id)) fail('unknown_facility', 'Unknown facility ' + id + '.');
  if (v.effect === 'stop_moved' && !data.stops.some(s => s.stop_id === v.replacement_stop_id)) fail('invalid_event', 'stop_moved needs a known replacement_stop_id.');
  if (v.active_periods.some(x => x.end && Date.parse(x.end) <= Date.parse(x.start))) fail('invalid_event', 'An active period must end after it starts.');
  if (!a.versions.length) data.alerts.push(a);
  a.versions.push(v);
  subs.onAlert(ctx, data, a);
}

function tripUpdated(ctx, data, p) {
  const trip = net.tripById(data, p.trip_id);
  if (!trip) fail('unknown_trip', 'No computed trip instance with that ID.');
  const skipped = p.skipped_stop_ids || [];
  for (const id of skipped) if (!trip.stops.some(s => s.stop_id === id)) fail('invalid_event', 'Skipped stop ' + id + ' is not on the trip.');
  const seq = data.trip_updates.filter(u => u.trip_id === p.trip_id).length + 1;
  const u = {trip_id: p.trip_id, seq, at: render(Date.parse(ctx.virtual_now), zone(data)), delay_min: p.delay_min || 0, cancelled: !!p.cancelled, skipped_stop_ids: skipped};
  data.trip_updates.push(u);
  subs.onTrip(ctx, data, trip, u);
}

function facilityChanged(ctx, data, p) {
  const f = data.facilities.find(x => x.facility_id === p.facility_id);
  if (!f) fail('unknown_facility', 'Facility does not exist.');
  if (p.stop_id && p.stop_id !== f.stop_id) fail('invalid_event', 'The facility is at ' + f.stop_id + '.');
  const last = f.history.at(-1), out = p.status === 'out_of_service';
  if (p.status_seq !== undefined && last && p.status_seq <= last.seq) fail('invalid_event', 'status_seq must be greater than ' + last.seq + '.');
  if (!out && (!last || last.status !== 'out_of_service')) moot(`${f.code} is already in service.`);
  const since = p.since || ctx.virtual_now;
  notLater(ctx, since, 'since');
  if (out && p.expected_return && Date.parse(p.expected_return) <= Date.parse(since)) fail('invalid_event', 'expected_return must be after since.');
  const e = {seq: p.status_seq ?? (last ? last.seq + 1 : 1), status: out ? 'out_of_service' : 'in_service', since: render(Date.parse(since), zone(data)),
    expected_return: out && p.expected_return ? render(Date.parse(p.expected_return), zone(data)) : null, note: p.note || null, recorded_at: stamp(ctx, data)};
  f.history.push(e);
  subs.onFacility(ctx, data, f, e);
}

function tapRecorded(ctx, data, p) {
  const r = data.routes.find(x => x.route_id === p.route_id);
  if (!r) fail('route_not_found', 'Route does not exist.');
  net.stopOrFail(data, p.stop_id);
  if (r.mode !== p.mode) fail('mode_mismatch', `${r.name} is ${r.mode}, not ${p.mode}.`);
  // The route serves the stop, or an alert in effect has moved one of its stops there.
  const serves = data.patterns.some(x => x.route_id === r.route_id && x.stops.some(s => net.stopOf(data, s.node_id) === p.stop_id)) ||
    net.alertsAt(data, Date.parse(ctx.virtual_now)).some(a => { const v = net.latest(a); return v.effect === 'stop_moved' && v.replacement_stop_id === p.stop_id && v.informed.route_ids.includes(r.route_id); });
  if (!serves) fail('invalid_event', `${r.name} does not serve ${p.stop_id}.`);
  const {rec, card} = cards.tap(ctx, data, p);
  const body = rec.result === 'declined' ? `A ${p.mode} tap at ${p.stop_id} was declined (${rec.reason}).` : `A ${p.mode} tap at ${p.stop_id} was charged ${money(rec.charged_cents)} (${rec.basis}).` +
    (rec.autoreload_entry_id ? ` Autoreload requested a load (${rec.autoreload_entry_id}); it is pending until settled.` : '');
  // A declined tap is always worth a notice; an accepted one only when a charge crosses the low-balance level.
  if (rec.result === 'declined' || rec.charged_cents > 0) {
    subs.onCard(ctx, data, card, {source: {kind: 'tap', id: rec.tap_id, version: 1}, title: rec.result === 'declined' ? 'Tap declined' : 'Low card balance', body,
      lowCheck: rec.result === 'declined' ? null : {before: card.balance_cents + rec.charged_cents}});
  }
}

function eligibilityDecided(ctx, data, p, event) {
  const c = redirect(ctx, data, event, p.card_id);
  const a = cards.decide(ctx, data, c, p);
  subs.onCard(ctx, data, c, {source: {kind: 'application', id: a.application_id, version: 1}, title: `Reduced fare ${a.status}`,
    body: a.status === 'approved' ? `Your ${a.program} reduced fare is approved until ${a.expires_at}; fares are halved from now on.` : `Your ${a.program} reduced-fare application was denied.`});
}

function paymentSettled(ctx, data, p, event) {
  let e;
  if (p.entry_id) {
    e = data.ledger.find(x => x.entry_id === p.entry_id);
    if (!e) fail('invalid_event', 'Unknown ledger entry.');
    if (e.kind !== 'load_pending') fail('load_not_pending', 'The load is not pending (' + e.kind + ').');
  } else if (p.card_id) {
    const c = redirect(ctx, data, event, p.card_id);
    e = data.ledger.filter(x => x.card_id === c.card_id && x.kind === 'load_pending').sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    if (!e) moot(`No load is pending on ${c.card_id}.`);
  } else fail('invalid_event', 'Give entry_id, or card_id with settle: oldest_pending.');
  const r = cards.settle(ctx, data, e, p.outcome);
  subs.onCard(ctx, data, r.card, {source: {kind: 'ledger', id: e.entry_id, version: 1}, title: r.result === 'settled' ? 'Card load settled' : 'Card load failed',
    body: r.result === 'settled' ? `Your ${money(e.amount_cents)} load (${e.entry_id}) has settled; the balance is ${money(r.card.balance_cents)}.`
      : `Your ${money(e.amount_cents)} load (${e.entry_id}) failed; nothing was added.`});
}

// Generated by Infra from the Messaging result for one notification.
function deliveryRecorded(ctx, data, p) {
  const n = data.notifications.find(x => x.notification_id === p.notification_id);
  if (!n) fail('notification_not_found', 'Notification does not exist.');
  if (n.status !== 'pending_delivery') fail('notification_not_pending', 'Notification is not waiting for delivery.');
  const stop = p.stop_run === true;
  n.outcome = {status: p.status, code: p.code, stop_run: stop, router_event_id: p.router_event_id, recorded_at: stamp(ctx, data)};
  if (p.status === 'committed') n.status = 'delivered';
  else if (p.status === 'rejected' && !stop && p.code !== 'idempotency_conflict') n.status = 'delivery_failed';
  // Otherwise (halting, unknown or idempotency_conflict) it stays pending_delivery for reconciliation.
}

const HANDLERS = {
  'service.alert_published': alertPublished,
  'service.trip_updated': tripUpdated,
  'facility.status_changed': facilityChanged,
  'fare.tap_recorded': tapRecorded,
  'fare.eligibility_decided': eligibilityDecided,
  'payment.settled': paymentSettled,
  'notification.delivery_recorded': deliveryRecorded
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  checkDates(event.payload, 'invalid_event');
  materialize(data, ctx.virtual_now);
  const before = copy(data);
  try {
    handler(ctx, data, copy(event.payload), event);
  } catch (error) {
    if (!(error instanceof Moot)) throw error;
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, before);
    data.ignored_events.push({event_id: event.event_id, at: stamp(ctx, data), operation: event.operation, reason: error.reason.slice(0, 200)});
  }
  log(ctx, 'hopline.event_applied', {operation: event.operation, event_id: event.event_id});
  return data;
}

module.exports = {applyEvent};
