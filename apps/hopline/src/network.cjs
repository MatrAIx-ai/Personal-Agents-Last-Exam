'use strict';
// The task's network: frequency-based trips with stable IDs, live trip state, facility and alert status.
// Nothing here changes data; every status is derived from records and the times passed in.
const {fail, MIN, zone, localDate, weekday, instantOf, addDays} = require('./common.cjs');

const period = date => (weekday(date) <= 5 ? 'weekday' : weekday(date) === 6 ? 'saturday' : 'sunday');
const minutes = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const hm = n => String(Math.floor(n / 60)).padStart(2, '0') + String(n % 60).padStart(2, '0');
const route = (data, id) => data.routes.find(r => r.route_id === id);
const node = (data, id) => data.nodes.find(n => n.node_id === id);
const stopOf = (data, nodeId) => node(data, nodeId)?.stop_id;
const nodesOf = (data, stopId) => data.nodes.filter(n => n.stop_id === stopId).map(n => n.node_id);

// Trip instances for one service date, as in GTFS frequencies.txt (exact_times): a trip leaves the first stop
// at start, start + headway, ... up to end. ID: trip:<route>:<direction>:<date>:<HHMM at the first stop>.
// Cached by the content of the schedule (Core hands each call a fresh copy of the data).
const byObject = new WeakMap(), byContent = new Map();
function tripsOn(data, date) {
  let byDate = byObject.get(data.patterns);
  if (!byDate) {
    const key = JSON.stringify([data.settings.time_zone, data.patterns, data.routes, data.nodes.map(n => [n.node_id, n.stop_id])]);
    byDate = byContent.get(key);
    if (!byDate) { byDate = new Map(); byContent.set(key, byDate); if (byContent.size > 20) byContent.delete(byContent.keys().next().value); }
    byObject.set(data.patterns, byDate);
  }
  if (byDate.has(date)) return byDate.get(date);
  const out = [];
  for (const p of data.patterns) {
    const r = route(data, p.route_id);
    for (const f of p.frequencies[period(date)] || []) {
      // Local noon fixes the day's UTC offset; service starts after the 02:00 DST change, so this is exact.
      const noon = instantOf(date, '12:00', zone(data));
      for (let m = minutes(f.start); m <= minutes(f.end); m += f.headway_min) {
        const start = noon + (m - 720) * MIN;
        out.push({trip_id: `trip:${r.short_name}:${p.direction}:${date}:${hm(m)}`, pattern_id: p.pattern_id, route_id: r.route_id, mode: r.mode,
          date, start, stops: p.stops.map(s => ({node_id: s.node_id, stop_id: stopOf(data, s.node_id), sched: start + s.offset_min * MIN}))});
      }
    }
  }
  out.sort((a, b) => a.start - b.start || a.trip_id.localeCompare(b.trip_id));
  byDate.set(date, out);
  return out;
}
function tripById(data, tripId) {
  const m = /^trip:[^:]+:[^:]+:(\d{4}-\d{2}-\d{2}):\d{4}$/.exec(tripId || '');
  return m ? tripsOn(data, m[1]).find(t => t.trip_id === tripId) || null : null;
}
// Trips that may run between two instants (service dates from the day before, for late trips).
function tripsBetween(data, from, to) {
  const out = [];
  for (let d = addDays(localDate(data, from), -1); d <= localDate(data, to); d = addDays(d, 1)) {
    for (const t of tripsOn(data, d)) if (t.stops[t.stops.length - 1].sched >= from && t.stops[0].sched <= to) out.push(t);
  }
  return out;
}

// ---- Alerts ----
const latest = a => a.versions[a.versions.length - 1];
const inPeriod = (v, t) => v.active_periods.some(p => Date.parse(p.start) <= t && (!p.end || t < Date.parse(p.end)));
function alertStatus(a, now) {
  const v = latest(a), t = Date.parse(now);
  if (v.msg_type === 'cancel') return 'cancelled';
  if (inPeriod(v, t)) return 'active';
  return v.active_periods.some(p => Date.parse(p.start) > t) ? 'upcoming' : 'ended';
}
// Alerts known at as_of whose latest version is in effect at t.
const alertsAt = (data, t) => data.alerts.filter(a => latest(a).msg_type !== 'cancel' && inPeriod(latest(a), t));
const informs = (v, {route_id, stop_id, facility_id}) => (route_id && v.informed.route_ids.includes(route_id)) ||
  (stop_id && v.informed.stop_ids.includes(stop_id)) || (facility_id && v.informed.facility_ids.includes(facility_id));

// ---- Facilities ----
// Status of a facility for a leg at time t, as known at as_of. An out-of-service facility stays out until a
// `restored` record; its expected_return is an estimate. For a leg after as_of, an estimate still in the future
// at as_of and before the leg makes it usable, reported in uses_estimates; an estimate that has already
// passed at as_of never counts as a restoration.
function facilityAt(f, t, asOf) {
  const known = f.history.filter(h => Date.parse(h.recorded_at) <= asOf);
  const entry = t <= asOf ? known.filter(h => Date.parse(h.since) <= t).pop() : known[known.length - 1];
  if (!entry || entry.status === 'in_service' || entry.status === 'restored') return {usable: true, status: 'in_service', seq: entry?.seq ?? 0};
  const er = entry.expected_return ? Date.parse(entry.expected_return) : null;
  const state = {status: 'out_of_service', seq: entry.seq, since: entry.since, expected_return: entry.expected_return, estimate_passed: er !== null && er <= asOf};
  if (t > asOf && er !== null && er > asOf && er <= t) return {...state, usable: true, uses_estimate: true};
  return {...state, usable: false};
}
const facilityNow = (f, now) => facilityAt(f, now, now);

// ---- Live trips ----
const latestUpdate = (data, tripId) => data.trip_updates.filter(u => u.trip_id === tripId).sort((a, b) => a.seq - b.seq).pop() || null;
// A trip as it runs, known at as_of: delay, cancellation and skipped stops from its latest trip update, and
// stop_moved / stop_closed / no_service alerts at each stop time. With `relaxed`, disruptions are ignored.
function live(data, trip, {relaxed = false} = {}) {
  const u = relaxed ? null : latestUpdate(data, trip.trip_id), delay = (u && u.delay_min || 0) * MIN;
  const stops = trip.stops.map(s => {
    let nodeId = s.node_id, stopId = s.stop_id, served = true, moved = null, closed = null;
    if (!relaxed) {
      for (const a of alertsAt(data, s.sched)) {
        const v = latest(a);
        if (v.effect === 'stop_moved' && v.replacement_stop_id && v.informed.route_ids.includes(trip.route_id) && v.informed.stop_ids.includes(stopId)) {
          moved = {alert_id: a.alert_id, version: v.version, from_stop_id: stopId};
          stopId = v.replacement_stop_id; nodeId = nodesOf(data, stopId)[0];
        }
      }
      for (const a of alertsAt(data, s.sched)) {
        const v = latest(a);
        if (v.effect === 'stop_closed' && v.informed.stop_ids.includes(stopId)) { served = false; closed = {alert_id: a.alert_id, version: v.version}; }
        if (v.effect === 'no_service' && v.informed.route_ids.includes(trip.route_id) && (!v.informed.stop_ids.length || v.informed.stop_ids.includes(stopId))) {
          served = false; closed = {alert_id: a.alert_id, version: v.version};
        }
      }
      if (u && u.skipped_stop_ids.includes(s.stop_id)) served = false;
    }
    return {node_id: nodeId, stop_id: stopId, sched: s.sched, time: s.sched + delay, served, moved, closed, skipped: !!(u && u.skipped_stop_ids.includes(s.stop_id))};
  });
  return {...trip, cancelled: !!(u && u.cancelled), delay_min: u ? u.delay_min || 0 : 0, update: u ? {trip_id: u.trip_id, seq: u.seq, at: u.at} : null, stops};
}

function stopOrFail(data, id) {
  const s = data.stops.find(x => x.stop_id === id);
  if (!s) fail('stop_not_found', 'Stop does not exist.');
  return s;
}

module.exports = {period, tripsOn, tripById, tripsBetween, route, node, stopOf, nodesOf, latest, alertStatus, alertsAt, informs, inPeriod,
  facilityAt, facilityNow, latestUpdate, live, stopOrFail, minutes};
