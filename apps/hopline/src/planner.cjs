'use strict';
// Deterministic time-dependent earliest-arrival search over computed trips (RAPTOR-style rounds).
// Round k holds the earliest arrival at each node using at most k rides; walking between rides follows
// station pathways and place access links, checked against facility status at the time each is reached.
const {fail, MIN, at, find} = require('./common.cjs');
const {STEP_FREE_MODES, LIMITS} = require('./catalog.cjs');
const net = require('./network.cjs');

const SEC = 1000;
function endpoint(data, ref, code) {
  const place = data.places.find(p => p.place_id === ref);
  if (place) return {ref, name: place.name, links: place.access.map(a => ({...a, link_id: net.linkId(ref, a.node_id)}))};
  const stop = data.stops.find(s => s.stop_id === ref);
  // A station is entered and left at street level (entrances and bus bays), so its elevators count.
  if (stop) return {ref, name: stop.name, links: data.nodes.filter(n => n.stop_id === ref && n.kind !== 'platform')
    .map(n => ({node_id: n.node_id, seconds: 0, length_m: 0, step_free: true, link_id: net.linkId(ref, n.node_id)}))};
  fail(code, 'No place or stop with that ID.');
}

function edges(data) {
  const out = new Map();
  const add = (from, e) => { if (!out.has(from)) out.set(from, []); out.get(from).push(e); };
  for (const p of data.pathways) {
    add(p.from, {to: p.to, p});
    if (p.bidirectional) add(p.to, {to: p.from, p});
  }
  return out;
}

// One search. opts: {depart, asOf, stepFree, maxWalk, maxRides, avoid, relaxed, banFirstRoute}.
function search(data, from, to, opts) {
  const graph = edges(data), K = opts.maxRides;
  const better = (a, b) => !b || a.time < b.time || (a.time === b.time && a.walk < b.walk);
  const facilityOk = (p, t) => {
    if (opts.stepFree && !STEP_FREE_MODES.includes(p.mode)) return {ok: false};
    if (!p.facility_id) return {ok: true};
    if (opts.relaxed) return {ok: true};
    const f = data.facilities.find(x => x.facility_id === p.facility_id), s = net.facilityAt(f, t, opts.asOf);
    return {ok: s.usable, estimate: s.uses_estimate ? {facility_id: f.facility_id, code: f.code, expected_return: s.expected_return} : null};
  };
  // Footpaths from the labels improved in this round (Dijkstra on time, walk distance bounded).
  const relax = (labels, round, seeds) => {
    const queue = [...seeds];
    while (queue.length) {
      queue.sort((a, b) => labels.get(a).time - labels.get(b).time);
      const n = queue.shift(), l = labels.get(n);
      for (const e of graph.get(n) || []) {
        const chk = facilityOk(e.p, l.time);
        if (!chk.ok) continue;
        const cand = {time: l.time + e.p.seconds * SEC, walk: l.walk + e.p.length_m, round,
          prev: {type: 'walk', node: n, round, pathway: e.p, estimate: chk.estimate}};
        if (cand.walk > opts.maxWalk) continue;
        if (better(cand, labels.get(e.to))) { labels.set(e.to, cand); if (!queue.includes(e.to)) queue.push(e.to); }
      }
    }
  };
  const rounds = [];
  const first = new Map();
  for (const a of from.links) {
    if (opts.stepFree && a.step_free === false) continue;
    const cand = {time: opts.depart + a.seconds * SEC, walk: a.length_m, round: 0, prev: {type: 'access', link: a}};
    if (cand.walk <= opts.maxWalk && better(cand, first.get(a.node_id))) first.set(a.node_id, cand);
  }
  relax(first, 0, [...first.keys()]);
  rounds.push(first);
  const horizon = opts.depart + LIMITS.search_hours * 3600e3;
  const trips = net.tripsBetween(data, opts.depart, horizon).filter(t => !opts.avoid.includes(t.mode)).map(t => net.live(data, t, {relaxed: opts.relaxed}))
    .filter(t => !t.cancelled);
  for (let k = 1; k <= K; k++) {
    const prevLabels = rounds[k - 1], labels = new Map(prevLabels), improved = new Set();
    for (const trip of trips) {
      let board = null;
      for (let i = 0; i < trip.stops.length; i++) {
        const s = trip.stops[i];
        if (board !== null && s.served) {
          const b = prevLabels.get(trip.stops[board].node_id);
          const cand = {time: s.time, walk: b.walk, round: k, prev: {type: 'ride', trip, board, alight: i, node: trip.stops[board].node_id, round: k - 1}};
          if (better(cand, labels.get(s.node_id))) { labels.set(s.node_id, cand); improved.add(s.node_id); }
        }
        if (board === null && s.served && i < trip.stops.length - 1) {
          // A boarding from a walking-only label is the first ride: it must leave within the departure window,
          // and (for the third alternative) not on the banned first route.
          const l = prevLabels.get(s.node_id), firstRide = l && l.round === 0;
          const late = firstRide && (s.time > (opts.firstBy ?? opts.depart + LIMITS.departure_window_min * MIN) || trip.route_id === opts.banFirstRoute);
          if (l && l.time <= s.time && !late) board = i;
        }
      }
    }
    relax(labels, k, [...improved]);
    rounds.push(labels);
  }
  // Best arrival at the destination for each number of rides.
  const best = [];
  for (let k = 0; k <= K; k++) {
    let b = null;
    for (const e of to.links) {
      if (opts.stepFree && e.step_free === false) continue;
      const l = rounds[k].get(e.node_id);
      if (!l) continue;
      const cand = {time: l.time + e.seconds * SEC, walk: l.walk + e.length_m, node: e.node_id, link: e, rides: null};
      if (cand.walk <= opts.maxWalk && (!b || cand.time < b.time || (cand.time === b.time && cand.walk < b.walk))) b = cand;
    }
    best.push(b);
  }
  return {rounds, best};
}

// Rebuild the path that reached `node` in round k.
function path(rounds, k, node) {
  const steps = [];
  let cur = {round: k, node};
  for (let guard = 0; guard < 500; guard++) {
    const l = rounds[cur.round].get(cur.node);
    if (l.prev.type === 'access') { steps.unshift({type: 'access', link: l.prev.link, node: cur.node, time: l.time}); break; }
    if (l.prev.type === 'walk') { steps.unshift({type: 'walk', pathway: l.prev.pathway, from: l.prev.node, to: cur.node, time: l.time, estimate: l.prev.estimate}); cur = {round: l.prev.round, node: l.prev.node}; continue; }
    steps.unshift({type: 'ride', trip: l.prev.trip, board: l.prev.board, alight: l.prev.alight});
    cur = {round: l.prev.round, node: l.prev.node};
  }
  return steps;
}

function itinerary(data, search, k, from, to, {depart, asOf}) {
  const b = search.best[k], steps = path(search.rounds, k, b.node), legs = [], estimates = [], edges = [];
  let walk = null, t = depart;
  // Every access link, pathway and ride in traversal order, joined end to end from `from` to `to`, with the
  // facility status entry each pathway was checked against (known at as_of), so a grader can replay the path.
  const edge = (e, enter, exit) => edges.push({...e, enter_at: at(data, enter), exit_at: at(data, exit)});
  const facility = (p, ms) => {
    if (!p.facility_id) return {facility_id: null, facility_status: null, facility_status_seq: null, uses_estimate: false};
    const s = net.facilityAt(data.facilities.find(f => f.facility_id === p.facility_id), ms, asOf);
    return {facility_id: p.facility_id, facility_status: s.status, facility_status_seq: s.seq, uses_estimate: !!s.uses_estimate};
  };
  const access = (link, fromRef, toRef, exit) => edge({kind: 'access', link_id: link.link_id, from: fromRef, to: toRef, length_m: link.length_m, step_free: link.step_free !== false}, t, exit);
  const name = nodeId => data.stops.find(s => s.stop_id === net.stopOf(data, nodeId))?.name;
  const flush = () => { if (walk && walk.length_m === 0 && walk.arriveMs === walk.departMs) walk = null; if (walk) { walk.arrive = at(data, walk.arriveMs); walk.minutes = Math.round((walk.arriveMs - walk.departMs) / MIN); delete walk.departMs; delete walk.arriveMs; legs.push(walk); walk = null; } };
  const walkTo = (fromName, toName, ms, length, pathway, stepFree) => {
    if (!walk) walk = {kind: 'walk', from: fromName, to: toName, depart: at(data, t), departMs: t, length_m: 0, pathways: [], step_free: true};
    walk.to = toName; walk.length_m += length; walk.arriveMs = ms; walk.step_free = walk.step_free && stepFree;
    if (pathway) walk.pathways.push({pathway_id: pathway.pathway_id, mode: pathway.mode, facility_id: pathway.facility_id || null});
    t = ms;
  };
  for (const s of steps) {
    if (s.type === 'access') {
      access(s.link, from.ref, s.node, s.time);
      walkTo(from.name, name(s.node), s.time, s.link.length_m, null, s.link.step_free !== false);
    } else if (s.type === 'walk') {
      const p = s.pathway;
      edge({kind: 'pathway', pathway_id: p.pathway_id, from: s.from, to: s.to, mode: p.mode, length_m: p.length_m, step_free: STEP_FREE_MODES.includes(p.mode), ...facility(p, t)}, t, s.time);
      walkTo(name(s.from), name(s.to), s.time, p.length_m, p, STEP_FREE_MODES.includes(p.mode));
      if (s.estimate && !estimates.some(e => e.facility_id === s.estimate.facility_id)) estimates.push(s.estimate);
    } else {
      flush();
      const bs = s.trip.stops[s.board], as = s.trip.stops[s.alight], r = net.route(data, s.trip.route_id);
      legs.push({kind: 'ride', route_id: r.route_id, route: r.name, mode: r.mode, trip_id: s.trip.trip_id, from_stop_id: bs.stop_id, from: name(bs.node_id),
        to_stop_id: as.stop_id, to: name(as.node_id), scheduled_departure: at(data, bs.sched), departure: at(data, bs.time), arrival: at(data, as.time),
        delay_min: s.trip.delay_min, trip_update: s.trip.update, moved_stop: bs.moved || as.moved || null});
      edge({kind: 'ride', trip_id: s.trip.trip_id, route_id: r.route_id, mode: r.mode, from: bs.node_id, to: as.node_id, from_stop_id: bs.stop_id, to_stop_id: as.stop_id}, bs.time, as.time);
      t = as.time;
    }
  }
  access(b.link, b.node, to.ref, b.time);
  if (b.link.seconds || b.link.length_m || !walk) walkTo(walk ? walk.to : name(b.node), to.name, b.time, b.link.length_m, null, b.link.step_free !== false);
  flush();
  const rides = legs.filter(l => l.kind === 'ride');
  return {depart: at(data, depart), arrive: at(data, b.time), arriveMs: b.time, duration_min: Math.round((b.time - depart) / MIN), transfers: Math.max(0, rides.length - 1),
    walk_m: b.walk, step_free: legs.every(l => l.kind !== 'walk' || l.step_free), first_route: rides[0]?.route_id || null, legs, edges, uses_estimates: estimates};
}

const sameRides = (a, b) => JSON.stringify(a.legs.filter(l => l.kind === 'ride').map(l => l.trip_id + l.from_stop_id + l.to_stop_id)) ===
  JSON.stringify(b.legs.filter(l => l.kind === 'ride').map(l => l.trip_id + l.from_stop_id + l.to_stop_id));
const edgeKey = it => JSON.stringify(it.edges.map(e => e.kind === 'ride' ? [e.trip_id, e.from, e.to] : [e.link_id || e.pathway_id, e.from]));
const sameEdges = (a, b) => edgeKey(a) === edgeKey(b);
const dominated = (a, b) => a.arriveMs >= b.arriveMs && a.transfers >= b.transfers && a.walk_m >= b.walk_m;

// Up to three itineraries: the earliest arrival; the earliest with fewer transfers; the earliest whose first
// route differs. Duplicates, and alternatives no better than an earlier one in any respect, are dropped.
function choose(data, from, to, opts) {
  const s = search(data, from, to, opts), out = [];
  const pick = (sr, ks) => {
    let best = null;
    for (const k of ks) { const b = sr.best[k]; if (b && (!best || b.time < sr.best[best].time)) best = k; }
    return best === null ? null : itinerary(data, sr, best, from, to, opts);
  };
  const ks = [...Array(opts.maxRides + 1).keys()];
  const one = pick(s, ks);
  if (!one) return out;
  out.push(one);
  const rides1 = one.legs.filter(l => l.kind === 'ride').length;
  const two = rides1 > 0 ? pick(s, ks.filter(k => k < rides1)) : null;
  if (two && !sameRides(two, one)) out.push(two);
  if (one.first_route) {
    const s3 = search(data, from, to, {...opts, banFirstRoute: one.first_route}), three = pick(s3, ks);
    if (three && !out.some(x => sameRides(three, x) || dominated(three, x))) out.push(three);
  }
  return out;
}

// Disruptions on the itineraries a search ignoring disruptions would choose.
function blockers(data, from, to, opts, chosen) {
  const relaxed = choose(data, from, to, {...opts, relaxed: true, maxRides: Math.max(opts.maxRides, 4)}), out = [];
  const add = b => { if (!out.some(x => x.id === b.id)) out.push(b); };
  for (const it of relaxed) {
    if (chosen.some(c => sameEdges(c, it))) continue;
    for (const leg of it.edges) {
      if (leg.kind === 'pathway') {
        if (leg.facility_id) {
          // Checked at the time the pathway is entered, as the search does.
          const f = data.facilities.find(x => x.facility_id === leg.facility_id), st = net.facilityAt(f, Date.parse(leg.enter_at), opts.asOf);
          if (!st.usable) add({id: f.facility_id, kind: 'facility', code: f.code, stop_id: f.stop_id, reason: st.estimate_passed ? 'estimate_passed' : 'out_of_service',
            expected_return: st.expected_return || null});
        }
      } else if (leg.kind === 'ride') {
        const trip = net.live(data, net.tripById(data, leg.trip_id));
        if (trip.cancelled) add({id: trip.trip_id, kind: 'trip', reason: 'cancelled', trip_update: trip.update});
        for (const s of trip.stops.filter(x => [leg.from_stop_id, leg.to_stop_id].includes(x.stop_id) || (x.moved && [leg.from_stop_id, leg.to_stop_id].includes(x.moved.from_stop_id)))) {
          if (s.skipped) add({id: trip.trip_id + '@' + s.stop_id, kind: 'trip', trip_id: trip.trip_id, stop_id: s.stop_id, reason: 'skipped_stop', trip_update: trip.update});
          if (s.closed) add({id: s.stop_id, kind: 'stop', stop_id: s.stop_id, reason: 'closed', alert: s.closed});
        }
      }
    }
  }
  return out;
}

function serviceState(data, asOf, from, to, itineraries, blocks) {
  const trips = new Set([...itineraries.flatMap(i => i.legs.filter(l => l.kind === 'ride').map(l => l.trip_id)), ...blocks.filter(b => b.kind === 'trip').map(b => b.trip_id || b.id)]);
  return {
    alerts: data.alerts.filter(a => ['active', 'upcoming'].includes(net.alertStatus(a, new Date(asOf).toISOString())) || a.versions.at(-1).active_periods.some(p => Date.parse(p.start) <= to && (!p.end || Date.parse(p.end) > from)))
      .filter(a => a.versions.at(-1).msg_type !== 'cancel').map(a => ({alert_id: a.alert_id, version: a.versions.at(-1).version, effect: a.versions.at(-1).effect})),
    facilities: data.facilities.map(f => ({f, s: net.facilityAt(f, asOf, asOf)})).filter(x => x.s.status === 'out_of_service')
      .map(x => ({facility_id: x.f.facility_id, code: x.f.code, status: x.s.status, status_seq: x.s.seq, expected_return: x.s.expected_return || null, estimate_passed: !!x.s.estimate_passed})),
    trip_updates: [...trips].map(id => net.latestUpdate(data, id)).filter(Boolean).map(u => ({trip_id: u.trip_id, seq: u.seq, at: u.at}))
  };
}

function describe(blocks) {
  return blocks.map(b => b.kind === 'facility' ? `${b.id} (${b.code}, ${b.reason})` : b.kind === 'trip' ? `${b.trip_id || b.id} (${b.reason})` : `${b.id} (stop closed)`).join(', ');
}

// hopline.trips.plan
function plan(data, args, asOfIso, fareFor) {
  const asOf = Date.parse(asOfIso);
  const from = endpoint(data, args.from, 'place_not_found'), to = endpoint(data, args.to, 'place_not_found');
  if (args.from === args.to) fail('no_route', 'Origin and destination are the same.');
  if ((args.depart_at ? 1 : 0) + (args.arrive_by ? 1 : 0) !== 1) fail('invalid_window', 'Give exactly one of depart_at and arrive_by.');
  const when = Date.parse(args.depart_at || args.arrive_by);
  if (when > asOf + LIMITS.planning_days * 86400e3) fail('outside_planning_horizon', 'Plans reach at most 7 days ahead.');
  if (when < asOf - 86400e3) fail('outside_planning_horizon', 'Plans start at most 1 day in the past.');
  // With arrive_by, any departure that arrives in time counts (the departure window is the deadline itself).
  const opts = {asOf, stepFree: !!args.step_free, maxWalk: args.max_walk_m ?? 1200, maxRides: (args.max_transfers ?? 2) + 1, avoid: args.avoid_modes || [],
    ...(args.arrive_by ? {firstBy: when} : {})};
  let depart = when;
  if (args.arrive_by) {
    // The latest departure whose earliest arrival is in time (arrival is monotone in departure time).
    const arrival = d => { const s = search(data, from, to, {...opts, depart: d}); return Math.min(...s.best.filter(Boolean).map(b => b.time)); };
    let lo = when - LIMITS.search_hours * 3600e3, hi = when;
    if (!(arrival(lo) <= when)) depart = null;
    else { while (hi - lo > MIN) { const mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN || lo + MIN; if (arrival(mid) <= when) lo = mid; else hi = mid; } depart = lo; }
  }
  let itineraries = depart === null ? [] : choose(data, from, to, {...opts, depart});
  if (args.arrive_by) itineraries = itineraries.filter(i => i.arriveMs <= when);
  const start = depart ?? when - LIMITS.search_hours * 3600e3;
  const blocks = blockers(data, from, to, {...opts, depart: start}, itineraries);
  if (!itineraries.length) {
    const anyTrip = net.tripsBetween(data, start, start + LIMITS.departure_window_min * MIN).some(t => t.stops.some(s => s.sched >= start && s.sched <= start + LIMITS.departure_window_min * MIN));
    if (!anyTrip && !blocks.length) fail('outside_service_hours', 'No service runs in that window.');
    if (opts.stepFree) fail('no_step_free_route', 'No step-free itinerary.' + (blocks.length ? ' Blockers: ' + describe(blocks) + '.' : ''));
    fail('no_route', 'No itinerary.' + (blocks.length ? ' Blockers: ' + describe(blocks) + '.' : ''));
  }
  for (const it of itineraries) {
    it.fare = fareFor(it);
    delete it.arriveMs;
  }
  return {from: from.ref, to: to.ref, itineraries, blockers: blocks,
    service_state: serviceState(data, asOf, start, start + LIMITS.search_hours * 3600e3, itineraries, blocks)};
}

module.exports = {plan, choose, blockers, endpoint, search};
