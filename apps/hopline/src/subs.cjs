'use strict';
// Subscription evaluation, run only inside business events, in subscription-ID order.
const {MIN, DAY, localDate, weekday, addDays, instantOf, zone, human, money, hhmm} = require('./common.cjs');
const {URGENT_EFFECTS, LIMITS} = require('./catalog.cjs');
const net = require('./network.cjs');
const planner = require('./planner.cjs');
const {notify, resolve, told, withdraw} = require('./notify.cjs');
// A newer version of a source withdraws held notices for earlier versions, even when it creates none itself.
const supersede = (ctx, data, id, version) => withdraw(data, n => n.source.id === id && (n.source.version ?? 0) < version, ctx.virtual_now);

const ordered = data => [...data.subscriptions].filter(s => s.status === 'active').sort((a, b) => a.subscription_id.localeCompare(b.subscription_id, 'en', {numeric: true}));
const saved = (data, id) => data.saved.find(s => s.saved_id === id);
const short = id => id.replace(/^(rt|st|fac)-/, '');
const minutes = net.minutes;

// Occurrences of a weekly window {days, start, end} that have not ended, within the 7-day planning horizon.
function occurrences(data, w, now) {
  const out = [], t = Date.parse(now), today = localDate(data, t);
  for (let i = 0; i <= LIMITS.planning_days; i++) {
    const d = addDays(today, i);
    if (!w.days.includes(weekday(d))) continue;
    const start = instantOf(d, w.start, zone(data)), end = minutes(w.end) > minutes(w.start) ? instantOf(d, w.end, zone(data)) : instantOf(addDays(d, 1), w.end, zone(data));
    if (end > t && start <= t + LIMITS.planning_days * DAY) out.push({date: d, start, end});
  }
  return out;
}
const overlaps = (data, w, ranges, now) => !w || occurrences(data, w, now).some(o => ranges.some(r => r.start < o.end && (r.end === null || r.end > o.start)));
const periods = v => v.active_periods.map(p => ({start: Date.parse(p.start), end: p.end ? Date.parse(p.end) : null}));

// ---- Saved commutes ----
// For each occurrence of the commute window: the usual itinerary (planned ignoring disruptions) and the one
// available now. The commute is affected on that date when no itinerary is left, when the usual itinerary
// uses something disrupted, when the best available one relies on an estimated return (an estimate is not a
// restoration), when it rides a trip delayed by at least the threshold, or when a stop it uses has moved.
function commuteStatus(data, sub, c, now) {
  const from = planner.endpoint(data, c.from_ref, 'place_not_found'), to = planner.endpoint(data, c.to_ref, 'place_not_found'), asOf = Date.parse(now);
  const base = {asOf, stepFree: c.step_free, maxWalk: c.max_walk_m, maxRides: c.max_transfers + 1, avoid: c.avoid_modes};
  const days = [];
  for (const o of occurrences(data, c.window, now)) {
    const depart = Math.max(o.start, asOf), opts = {...base, depart, firstBy: o.end};
    const usual = planner.choose(data, from, to, {...opts, relaxed: true})[0] || null;
    const avail = planner.choose(data, from, to, opts);
    const disrupted = usual ? planner.blockers(data, from, to, opts, avail).filter(b => usesBlock(usual, b, data)) : [];
    const best = avail[0] || null, reasons = [];
    if (!best) reasons.push('no_itinerary');
    if (disrupted.length) reasons.push('usual_disrupted');
    if (best && best.uses_estimates.length) reasons.push('relies_on_estimate');
    const delayed = best ? best.legs.filter(l => l.kind === 'ride' && l.delay_min >= (sub.delay_threshold_min ?? 10)) : [];
    if (delayed.length) reasons.push('delayed');
    const moved = best ? best.legs.filter(l => l.kind === 'ride' && l.moved_stop) : [];
    if (moved.length) reasons.push('stop_moved');
    days.push({date: o.date, reasons, usual, best, disrupted, estimates: best ? best.uses_estimates : [], delayed, moved});
  }
  return {from, to, days};
}
function usesBlock(it, b, data) {
  if (b.kind === 'facility') return it.legs.some(l => l.kind === 'walk' && l.pathways.some(p => p.facility_id === b.id));
  if (b.kind === 'trip') return it.legs.some(l => l.kind === 'ride' && l.trip_id === (b.trip_id || b.id));
  return it.legs.some(l => l.kind === 'ride' && (l.from_stop_id === b.stop_id || l.to_stop_id === b.stop_id));
}
// Does this day's assessment involve the event's subject?
function involves(day, cause, data) {
  const its = [day.usual, day.best].filter(Boolean);
  if (cause.kind === 'facility') return day.disrupted.some(b => b.id === cause.id) || day.estimates.some(e => e.facility_id === cause.id) ||
    its.some(it => it.legs.some(l => l.kind === 'walk' && l.pathways.some(p => p.facility_id === cause.id)));
  if (cause.kind === 'trip') return day.disrupted.some(b => (b.trip_id || b.id) === cause.id) || day.delayed.some(l => l.trip_id === cause.id);
  // An alert involves the day only through what the planner does with it at that day's leg times: a stop it
  // closed or a trip it removed on the usual itinerary, or a stop it moved on the best one. Informational
  // effects (detour without a replacement stop, reduced_service, significant_delays) never do.
  return day.disrupted.some(b => b.alert && b.alert.alert_id === cause.id) || day.moved.some(l => l.moved_stop.alert_id === cause.id);
}
const via = it => { const rides = it.legs.filter(l => l.kind === 'ride'); return rides.length > 1 ? rides[0].to : rides[0]?.route || 'walking'; };
const routes = it => it.legs.filter(l => l.kind === 'ride').map(l => l.route).join(' then ');
const dayName = (data, d) => human(data, instantOf(d, '12:00', zone(data))).split(',')[0];

function commute(ctx, data, sub, cause, headline) {
  const c = saved(data, sub.target.id);
  if (!c) return;
  const st = commuteStatus(data, sub, c, ctx.virtual_now);
  const hit = st.days.filter(d => d.reasons.length && involves(d, cause, data));
  const label = `${saved(data, c.from_saved_id)?.label || st.from.name} to ${saved(data, c.to_saved_id)?.label || st.to.name}`;
  if (!hit.length) {
    // A resolution (restored facility, cancelled alert) after the person was told: say the commute is back.
    if (cause.resolved && told(data, sub, cause.id) && st.days.every(d => !d.reasons.length || !involves(d, cause, data))) {
      notify(ctx, data, sub, {source: cause, title: `Your commute ${label} is back to normal`, body: `${headline} Your saved commute ${label} has its usual itinerary again.`});
    }
    return;
  }
  const first = hit[0], usual = first.usual;
  const out = hit.filter(d => d.reasons.some(r => r === 'no_itinerary' || r === 'usual_disrupted'));
  const est = hit.filter(d => !out.includes(d) && d.reasons.includes('relies_on_estimate'));
  const parts = [headline];
  const kind = c.step_free ? 'step-free ' : '';
  if (out.length) parts.push(`Your saved commute ${label}${usual ? ' via ' + via(usual) : ''} has no usual ${kind}itinerary on ${out.map(d => dayName(data, d.date)).join(', ')}.`);
  if (est.length) parts.push(`On ${est.map(d => dayName(data, d.date)).join(', ')} it works only if the estimated return holds; the return time is an estimate, not a confirmed restoration.`);
  const alt = out.length && first.best && (!usual || JSON.stringify(first.best.legs) !== JSON.stringify(usual.legs)) ? first.best : null;
  if (alt && usual) parts.push(`${c.step_free ? 'Step-free alternative' : 'Alternative'}: ${routes(alt)} to ${st.to.name} (about ${Math.max(0, Math.round((Date.parse(alt.arrive) - Date.parse(usual.arrive)) / MIN))} min longer).`);
  else if (out.length && !first.best) parts.push(`No ${kind}itinerary is available for ${dayName(data, first.date)} in your window.`);
  if (first.delayed.length) parts.push(`Delayed: ${first.delayed.map(l => `${l.route} ${l.delay_min} min`).join(', ')}.`);
  const movedDays = hit.filter(d => d.moved.length);
  if (movedDays.length) {
    const l = movedDays[0].moved[0], fromName = data.stops.find(x => x.stop_id === l.moved_stop.from_stop_id).name;
    parts.push(`On ${movedDays.map(d => dayName(data, d.date)).join(', ')} ${l.route} stops at ${l.from} instead of ${fromName}.`);
  }
  notify(ctx, data, sub, {source: {kind: cause.kind, id: cause.id, version: cause.version}, urgent: !!cause.urgent,
    title: `${cause.title}: your ${kind}commute is affected`, body: parts.join(' ')});
}

// ---- Event hooks ----
function onAlert(ctx, data, a) {
  const v = net.latest(a), cancelled = v.msg_type === 'cancel', urgent = URGENT_EFFECTS.includes(v.effect);
  supersede(ctx, data, a.alert_id, v.version);
  if (cancelled) resolve(data, a.alert_id, ctx.virtual_now);
  const cause = {kind: 'alert', id: a.alert_id, version: v.version, urgent, resolved: cancelled, title: v.header};
  for (const sub of ordered(data)) {
    const t = sub.target;
    if (t.kind === 'commute') { commute(ctx, data, sub, cause, cancelled ? `Cancelled: ${v.header}.` : `${v.header}.`); continue; }
    if (!['route', 'stop', 'facility'].includes(t.kind) || !net.informs(v, {[t.kind + '_id']: t.id})) continue;
    if (cancelled) {
      if (told(data, sub, a.alert_id)) notify(ctx, data, sub, {source: cause, title: `Cancelled: ${v.header}`, body: `The alert "${v.header}" is cancelled.`});
      continue;
    }
    if (!overlaps(data, sub.window, periods(v), ctx.virtual_now)) continue;
    const when = v.active_periods.map(p => `${human(data, p.start)} to ${p.end ? human(data, p.end) : 'further notice'}`).join('; ');
    notify(ctx, data, sub, {source: cause, urgent, title: v.header, body: `${v.header}. ${v.description ? v.description + ' ' : ''}In effect ${when}.`});
  }
}
function onTrip(ctx, data, trip, u) {
  supersede(ctx, data, trip.trip_id, u.seq);
  const r = net.route(data, trip.route_id), dep = trip.stops[0].sched;
  const what = u.cancelled ? 'cancelled' : u.delay_min ? `running ${u.delay_min} min late` : 'changed';
  const headline = `${r.name} ${hhmm(data, dep)} trip from ${data.stops.find(s => s.stop_id === trip.stops[0].stop_id).name} is ${what}` +
    (u.skipped_stop_ids.length ? `, skipping ${u.skipped_stop_ids.map(id => data.stops.find(s => s.stop_id === id)?.name || id).join(', ')}` : '') + '.';
  const cause = {kind: 'trip', id: trip.trip_id, version: u.seq, title: `${r.name} ${hhmm(data, dep)} ${what}`};
  for (const sub of ordered(data)) {
    const t = sub.target;
    if (t.kind === 'commute') { commute(ctx, data, sub, cause, headline); continue; }
    const hits = (t.kind === 'route' && t.id === trip.route_id) || (t.kind === 'stop' && trip.stops.some(s => s.stop_id === t.id));
    if (!hits || !(u.cancelled || u.skipped_stop_ids.length || u.delay_min >= (sub.delay_threshold_min ?? 10))) continue;
    if (!overlaps(data, sub.window, [{start: dep, end: trip.stops.at(-1).sched}], ctx.virtual_now)) continue;
    notify(ctx, data, sub, {source: cause, title: cause.title, body: headline});
  }
}
function onFacility(ctx, data, f, e) {
  supersede(ctx, data, f.facility_id, e.seq);
  const out = e.status === 'out_of_service', stop = data.stops.find(s => s.stop_id === f.stop_id);
  if (!out) resolve(data, f.facility_id, ctx.virtual_now);
  const headline = out ? `${f.name} (${f.code}) is out of service from ${human(data, e.since)}` +
    (e.expected_return ? `; expected back ${human(data, e.expected_return)} (estimate).` : '; no estimate for its return.')
    : `${f.code} at ${stop.name} is back in service from ${human(data, e.since)}.`;
  const kindName = f.kind[0].toUpperCase() + f.kind.slice(1);
  const cause = {kind: 'facility', id: f.facility_id, version: e.seq, resolved: !out, title: out ? `${kindName} out at ${stop.name}` : `${kindName} back at ${stop.name}`};
  for (const sub of ordered(data)) {
    const t = sub.target;
    if (t.kind === 'commute') { commute(ctx, data, sub, cause, headline); continue; }
    if (!((t.kind === 'facility' && t.id === f.facility_id) || (t.kind === 'stop' && t.id === f.stop_id))) continue;
    if (!out) { if (told(data, sub, f.facility_id)) notify(ctx, data, sub, {source: cause, title: cause.title, body: headline}); continue; }
    if (!overlaps(data, sub.window, [{start: Date.parse(e.since), end: e.expected_return ? Date.parse(e.expected_return) : null}], ctx.virtual_now)) continue;
    notify(ctx, data, sub, {source: cause, title: cause.title, body: headline});
  }
}
// lowCheck: a charged tap notifies only when it takes the balance from at or above the alert level to below it.
function onCard(ctx, data, c, {source, title, body, lowCheck = null}) {
  for (const sub of ordered(data)) {
    if (sub.target.kind !== 'card' || sub.target.id !== c.card_id) continue;
    if (lowCheck && !(sub.low_balance_cents !== null && lowCheck.before >= sub.low_balance_cents && c.balance_cents < sub.low_balance_cents)) continue;
    notify(ctx, data, sub, {source, title, body: body + (sub.low_balance_cents !== null && c.balance_cents < sub.low_balance_cents ? ` The balance is ${money(c.balance_cents)}, below your ${money(sub.low_balance_cents)} alert.` : '')});
  }
}

module.exports = {onAlert, onTrip, onFacility, onCard, commuteStatus, occurrences};
