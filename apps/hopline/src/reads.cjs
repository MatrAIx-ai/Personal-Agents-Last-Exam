'use strict';
// Agent reads. They run on a copy materialized at ctx.virtual_now and never change App data.
const {fail, copy, render, zone, MIN, DAY} = require('./common.cjs');
const {FARES, PROGRAMS, CATALOG_VERSION, LIMITS} = require('./catalog.cjs');
const net = require('./network.cjs');
const planner = require('./planner.cjs');
const cards = require('./cards.cjs');

const name = (data, stopId) => data.stops.find(s => s.stop_id === stopId)?.name || stopId;
const alertView = (a, now) => ({alert_id: a.alert_id, status: net.alertStatus(a, now), latest_version: net.latest(a).version, ...copy(net.latest(a))});
function window(data, from, to, maxHours) {
  const a = Date.parse(from), b = Date.parse(to);
  if (!(b > a) || b - a > maxHours * 3600e3) fail('invalid_window', `The window must end after it starts and span at most ${maxHours} h.`);
  return [a, b];
}
const routesAt = (data, stopId) => [...new Set(data.patterns.filter(p => p.stops.some(s => net.stopOf(data, s.node_id) === stopId)).map(p => p.route_id))];

function departures(data, args, now) {
  const stop = net.stopOrFail(data, args.stop_id), [a, b] = window(data, args.from, args.to, LIMITS.departures_window_h);
  if (a > Date.parse(now) + LIMITS.planning_days * DAY) fail('outside_planning_horizon', 'Departures reach at most 7 days ahead.');
  const out = [];
  for (const t of net.tripsBetween(data, a, b)) {
    const lt = net.live(data, t);
    t.stops.forEach((s, i) => {
      if (s.stop_id !== stop.stop_id || i === t.stops.length - 1 || s.sched < a || s.sched > b) return;
      const ls = lt.stops[i], p = data.patterns.find(x => x.pattern_id === t.pattern_id), r = net.route(data, t.route_id);
      const status = lt.cancelled ? 'cancelled' : ls.skipped ? 'skipped' : ls.moved ? 'moved' : !ls.served ? 'not_served' : lt.delay_min ? 'delayed' : 'scheduled';
      out.push({trip_id: t.trip_id, route_id: r.route_id, route: r.name, mode: r.mode, direction: p.direction, headsign: p.headsign,
        scheduled: render(s.sched, zone(data)), estimate: ['cancelled', 'skipped', 'not_served'].includes(status) ? null : render(ls.time, zone(data)),
        delay_min: lt.delay_min, status, trip_update: lt.update, moved_to: ls.moved ? ls.stop_id : null, alert: ls.moved || ls.closed || null});
    });
  }
  out.sort((x, y) => Date.parse(x.scheduled) - Date.parse(y.scheduled) || x.trip_id.localeCompare(y.trip_id));
  return {stop_id: stop.stop_id, departures: out};
}

function read(ctx, data, name_, args) {
  const now = ctx.virtual_now, as_of = render(Date.parse(now), zone(data)), out = v => ({as_of, ...v});
  switch (name_) {
    case 'hopline.places.search': {
      const q = (args.query || '').trim().toLocaleLowerCase(), hit = x => !q || x.name.toLocaleLowerCase().includes(q) || (x.place_id || x.stop_id).includes(q);
      return out({places: data.places.filter(hit).map(p => ({place_id: p.place_id, name: p.name, kind: p.kind, nearby_stops: p.access.map(l => ({stop_id: net.stopOf(data, l.node_id), walk_m: l.length_m, step_free: l.step_free !== false}))})),
        stops: data.stops.filter(hit).map(s => ({stop_id: s.stop_id, name: s.name, kind: s.kind, routes: routesAt(data, s.stop_id)}))});
    }
    case 'hopline.stops.get': {
      const s = net.stopOrFail(data, args.stop_id), nodes = net.nodesOf(data, s.stop_id);
      return out({stop: {...copy(s), routes: routesAt(data, s.stop_id), nodes: copy(data.nodes.filter(n => nodes.includes(n.node_id))),
        pathways: copy(data.pathways.filter(p => nodes.includes(p.from) || nodes.includes(p.to))),
        facilities: data.facilities.filter(f => f.stop_id === s.stop_id).map(f => ({facility_id: f.facility_id, code: f.code, kind: f.kind, name: f.name, pathway_ids: f.pathway_ids,
          ...(({usable, uses_estimate, ...st}) => st)(net.facilityNow(f, Date.parse(now))), history: copy(f.history)})),
        alerts: data.alerts.filter(a => ['active', 'upcoming'].includes(net.alertStatus(a, now)) && net.informs(net.latest(a), {stop_id: s.stop_id})).map(a => alertView(a, now))}});
    }
    case 'hopline.routes.get': {
      const r = data.routes.find(x => x.route_id === args.route_id);
      if (!r) fail('route_not_found', 'Route does not exist.');
      return out({route: {...copy(r), patterns: data.patterns.filter(p => p.route_id === r.route_id).map(p => ({pattern_id: p.pattern_id, direction: p.direction, headsign: p.headsign,
        stops: p.stops.map(x => ({stop_id: net.stopOf(data, x.node_id), name: name(data, net.stopOf(data, x.node_id)), offset_min: x.offset_min})), frequencies: copy(p.frequencies)})),
        trip_id_rule: `trip:${r.short_name}:<direction>:<service date YYYY-MM-DD>:<HHMM leaving the first stop>`,
        alerts: data.alerts.filter(a => ['active', 'upcoming'].includes(net.alertStatus(a, now)) && net.informs(net.latest(a), {route_id: r.route_id})).map(a => alertView(a, now))}});
    }
    case 'hopline.departures.list': return out(departures(data, args, now));
    case 'hopline.trips.plan': {
      if (args.card_id) cards.card(data, args.card_id);
      return out(planner.plan(data, args, now, it => cards.quote(data, args.card_id, it.legs.filter(l => l.kind === 'ride'))));
    }
    case 'hopline.alerts.list': {
      const list = data.alerts.filter(a => (!args.route_id || net.informs(net.latest(a), {route_id: args.route_id})) && (!args.stop_id || net.informs(net.latest(a), {stop_id: args.stop_id})) &&
        (!args.facility_id || net.informs(net.latest(a), {facility_id: args.facility_id})) && (!args.status || net.alertStatus(a, now) === args.status));
      return out({alerts: list.map(a => alertView(a, now))});
    }
    case 'hopline.alerts.get': {
      const a = data.alerts.find(x => x.alert_id === args.alert_id);
      if (!a) fail('alert_not_found', 'Alert does not exist.');
      const v = args.version ? a.versions.find(x => x.version === args.version) : null;
      if (args.version && !v) fail('alert_not_found', 'No such version.');
      return out({alert: {alert_id: a.alert_id, status: net.alertStatus(a, now), latest_version: net.latest(a).version, version: copy(v || net.latest(a)), versions: copy(a.versions)}});
    }
    case 'hopline.saved.list': return out({saved: copy(data.saved)});
    case 'hopline.subscriptions.list': return out({subscriptions: copy(data.subscriptions.filter(s => args.include_deleted || s.status !== 'deleted'))});
    case 'hopline.notifications.list': return out({notifications: copy(data.notifications.filter(n => !args.status || n.status === args.status))});
    case 'hopline.cards.get': {
      const list = args.card_id ? [cards.card(data, args.card_id)] : data.cards;
      return out({cards: list.map(c => cards.view(data, c, now))});
    }
    case 'hopline.cards.history': {
      const c = cards.card(data, args.card_id), [a, b] = window(data, args.from, args.to, LIMITS.history_days * 24);
      const inRange = t => Date.parse(t) >= a && Date.parse(t) <= b;
      return out({card_id: c.card_id, entries: copy(data.ledger.filter(e => (e.card_id === c.card_id || e.original_card_id === c.card_id) && inRange(e.at))),
        taps: copy(data.taps.filter(t => t.card_id === c.card_id && inRange(t.at)))});
    }
    case 'hopline.fares.products': return out({catalog_version: CATALOG_VERSION, fares: {rail_cents: FARES.rail, bus_cents: FARES.bus,
      transfer: `Within ${FARES.transfer_window_min} min of a boarding that started a fare, one transfer costs only the difference (bus to rail $0.70; rail to bus free).`,
      weekly_cap_cents: FARES.weekly_cap, weekly_cap_window: 'Monday 00:00 to the next Monday 00:00, local time', reduced: 'Halves every fare and the weekly cap.',
      negative_balance: 'A charged tap may take the balance down to minus the current rail fare.'},
      products: [{product: 'monthly', price_cents: FARES.monthly_pass, description: 'Every tap in one calendar month costs $0.00.'}],
      replacement_fee_cents: FARES.replacement_fee, reduced_fare_programs: PROGRAMS});
    default: return null;
  }
}

module.exports = {read};
