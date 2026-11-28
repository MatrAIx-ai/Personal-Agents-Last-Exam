'use strict';
// Scenario events, applied by Infra through env.apply_event at the event's time.
// Switchback has no scheduler: time effects due before the event are settled first.
const {fail} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const R = require('./rules.cjs');
const {ms, iso, DAY} = require('./clock.cjs');
const {settle, history} = require('./settle.cjs');
const {notify, money} = require('./notices.cjs');
const {nextId} = require('./ids.cjs');

const copy = value => structuredClone(value);

function affectedHolders(data, alert, now) {
  return data.reservations.filter(r => R.LIVE.has(R.currentState(data, r, now)) && R.affectedBy(data, r, now).includes(alert.id));
}

function alertNotices(ctx, data, alert, rows, verb) {
  for (const r of rows) {
    notify(ctx, data, {kind: 'alert_' + verb, object_type: 'reservation', object_id: r.id,
      title: `Alert ${verb} for your stay ${r.id}: ${alert.kind.replace(/_/g, ' ')}`,
      fields: [['Reservation', r.id], ['Facility', R.facility(data, r.facility_id).name], ['Site', r.site_id],
        ['Alert', `${alert.id}, ${alert.kind.replace(/_/g, ' ')}`], ['Window', `${alert.from} to ${alert.to}`],
        ['Details', alert.text], ['Reservation status', 'confirmed; ordinary refund ladder applies']]});
  }
}

const HANDLERS = {
  'switchback.inventory.claimed'(ctx, data, p, now) {
    const s = R.site(data, p.site_id), taken = [], skipped = [];
    for (const date of p.nights) {
      if (R.nightState(data, s, date, now) === 'open') taken.push(date);
      else skipped.push(date);
    }
    if (taken.length) data.claims.push({id: nextId(data.claims, 'claim'), site_id: s.id, nights: taken, claimed_at: ctx.virtual_now});
    log(ctx, 'switchback.inventory_claimed', {site_id: s.id, taken: taken.length, skipped: skipped.length});
  },
  'switchback.alert.posted'(ctx, data, p, now) {
    if (data.alerts.some(a => a.id === p.alert_id)) fail('invalid_event', 'Alert ID already exists.');
    R.facility(data, p.facility_id);
    if (!(ms(p.from) < ms(p.to))) fail('invalid_event', 'Alert window must end after it starts.');
    const alert = {id: p.alert_id, kind: p.kind, facility_id: p.facility_id, site_ids: p.site_ids,
      from: p.from, to: p.to, text: p.text, posted_at: ctx.virtual_now, cancelled_at: null, revisions: []};
    data.alerts.push(alert);
    // Holders learn about an alert when it is posted, even if it starts later.
    const rows = data.reservations.filter(r => R.LIVE.has(R.currentState(data, r, now)) &&
      R.affectedBy(data, r, Math.max(now, ms(alert.from))).includes(alert.id));
    alertNotices(ctx, data, alert, rows, 'posted');
  },
  'switchback.alert.updated'(ctx, data, p, now) {
    const alert = R.byId(data.alerts, p.alert_id, 'invalid_event', 'Alert');
    if (alert.cancelled_at) fail('invalid_event', 'A cancelled alert cannot be updated.');
    const probe = Math.max(now, ms(alert.from));
    const before = new Set(affectedHolders(data, alert, probe).map(r => r.id));
    alert.revisions.push({at: ctx.virtual_now, kind: alert.kind, site_ids: copy(alert.site_ids), from: alert.from, to: alert.to, text: alert.text});
    for (const k of ['kind', 'site_ids', 'from', 'to', 'text']) if (p[k] !== undefined) alert[k] = copy(p[k]);
    if (!(ms(alert.from) < ms(alert.to))) fail('invalid_event', 'Alert window must end after it starts.');
    const afterRows = affectedHolders(data, alert, Math.max(now, ms(alert.from)));
    const after = new Set(afterRows.map(r => r.id));
    // Only holders whose affected status changed are told.
    const changed = data.reservations.filter(r => before.has(r.id) !== after.has(r.id));
    alertNotices(ctx, data, alert, changed, 'updated');
  },
  'switchback.alert.cancelled'(ctx, data, p, now) {
    const alert = R.byId(data.alerts, p.alert_id, 'invalid_event', 'Alert');
    if (alert.cancelled_at) fail('invalid_event', 'Alert is already cancelled.');
    const rows = affectedHolders(data, alert, Math.max(now, ms(alert.from)));
    alert.cancelled_at = ctx.virtual_now;
    alertNotices(ctx, data, alert, rows, 'lifted');
  },
  'switchback.closure.ordered'(ctx, data, p, now) {
    if (data.closures.some(c => c.id === p.closure_id)) fail('invalid_event', 'Closure ID already exists.');
    const f = R.facility(data, p.facility_id);
    if (!(p.from < p.to)) fail('invalid_event', 'Closure must end after it starts.');
    const closure = {id: p.closure_id, facility_id: f.id, site_ids: p.site_ids, from: p.from, to: p.to,
      reason: p.reason, ordered_at: ctx.virtual_now};
    data.closures.push(closure);
    for (const r of data.reservations) {
      // The approved rule: a closure covering any night cancels the whole stay with a
      // full refund, whether the stay has started (checked_in) or not.
      if (!R.LIVE.has(R.currentState(data, r, now))) continue;
      const s = R.site(data, r.site_id);
      if (!r.nights.some(d => R.closureFor(data, s, d) === closure)) continue;
      r.state = 'closure_cancelled';
      history(r, ctx.virtual_now, 'closure_cancelled', {closure_id: closure.id});
      const pay = {id: nextId(data.payments, 'pay'), reservation_id: r.id, card_id: r.card_id, amount_cents: r.total_cents,
        kind: 'refund', reason: 'closure', created_at: ctx.virtual_now, posts_at: iso(now + R.REFUND_DELAY_DAYS * DAY, f.utc_offset), status: 'pending'};
      data.payments.push(pay);
      const c = data.wallet.cards.find(x => x.id === r.card_id);
      notify(ctx, data, {kind: 'closure', object_type: 'reservation', object_id: r.id,
        title: `Closure: ${f.name} stay ${r.id} is cancelled with a full refund`,
        fields: [['Reservation', r.id], ['Facility', f.name], ['Site', r.site_id],
          ['Nights', `${r.arrival} to ${r.departure}`], ['Reason', `closure ${closure.id}, ${closure.reason}`],
          ['Refund', `${money(r.total_cents)} to ${c ? R.cardLabel(c) : r.card_id}`], ['Refund posts', pay.posts_at.slice(0, 10)]]});
    }
  },
  'switchback.reservation.checked_in'(ctx, data, p, now) {
    const r = R.reservation(data, p.reservation_id), f = R.facility(data, r.facility_id);
    if (R.currentState(data, r, now) !== 'confirmed') fail('invalid_event', 'Only a confirmed stay can check in.');
    if (now < ms(`${r.arrival}T00:00:00${f.utc_offset}`)) fail('invalid_event', 'Check-in is only possible from arrival day.');
    r.state = 'checked_in';
    history(r, ctx.virtual_now, 'checked_in');
  },
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  settle(ctx, data);
  handler(ctx, data, event.payload, ms(ctx.virtual_now));
  log(ctx, 'switchback.event', {event_id: event.event_id, operation: event.operation});
  return data;
}

module.exports = {applyEvent, HANDLERS};
