'use strict';
// The fictional metro Ashford (America/New_York): 2 rail lines, 2 bus routes, 6 stations with entrances,
// platforms, pathways and facilities, and frequency schedules. Synthetic; GTFS is used as a format reference only.
const TZ = 'America/New_York';

const stops = [], nodes = [], pathways = [], facilities = [];
function station(id, name, {lines, stepFree = true, extra = []}) {
  stops.push({stop_id: id, name, kind: 'station', step_free: stepFree, external_ref: null});
  const short = id.replace(/^st-/, '');
  nodes.push({node_id: `${short}-entrance`, stop_id: id, kind: 'entrance', name: `${name} street entrance`});
  for (const l of lines) nodes.push({node_id: `${short}-${l}`, stop_id: id, kind: 'platform', name: `${name} ${l[0].toUpperCase() + l.slice(1)} Line platform`});
  for (const e of extra) nodes.push({...e, stop_id: id});
}
const stop = (id, name) => { stops.push({stop_id: id, name, kind: 'stop', step_free: true, external_ref: null}); nodes.push({node_id: id, stop_id: id, kind: 'stop', name}); };
function path(id, from, to, mode, seconds, length, facility = null) {
  pathways.push({pathway_id: id, from, to, mode, seconds, length_m: length, bidirectional: true, facility_id: facility});
}
function facility(id, code, kind, stopId, name, pathwayId) {
  facilities.push({facility_id: id, code, kind, stop_id: stopId, name, pathway_ids: [pathwayId], history: []});
}
// Street entrance to a platform: stairs, an escalator and an elevator (or what the station has).
function access(short, line, stopId, {stairs = true, escalators = [], elevators = [], ramps = []}) {
  const e = `${short}-entrance`, p = `${short}-${line}`;
  if (stairs) path(`pw-${short}-${line}-stairs`, e, p, 'stairs', 60, 30);
  for (const [code, name] of escalators) { const id = `pw-${short}-${code.toLowerCase()}`; path(id, e, p, 'escalator', 60, 30, 'fac-' + code.toLowerCase().replace('-', '')); facility('fac-' + code.toLowerCase().replace('-', ''), code, 'escalator', stopId, name, id); }
  for (const [code, name] of elevators) { const id = `pw-${short}-${code.toLowerCase()}`; path(id, e, p, 'elevator', 90, 20, 'fac-' + code.toLowerCase().replace('-', '')); facility('fac-' + code.toLowerCase().replace('-', ''), code, 'elevator', stopId, name, id); }
  for (const [code, name] of ramps) { const id = `pw-${short}-${code.toLowerCase()}`; path(id, e, p, 'ramp', 150, 120, 'fac-' + code.toLowerCase().replace('-', '')); facility('fac-' + code.toLowerCase().replace('-', ''), code, 'ramp', stopId, name, id); }
}

station('st-central', 'Central', {lines: ['blue', 'red'], extra: [{node_id: 'central-bay', kind: 'bus_bay', name: 'Central bus bay'}]});
path('pw-central-bay', 'central-bay', 'central-entrance', 'walkway', 120, 160);
access('central', 'blue', 'st-central', {escalators: [['ES-12', 'Central escalator, street to Blue Line platform']], elevators: [['EL-12', 'Central elevator, street to Blue Line platform']]});
access('central', 'red', 'st-central', {escalators: [['ES-14', 'Central escalator, street to Red Line platform']], elevators: [['EL-14', 'Central elevator, street to Red Line platform']]});
station('st-harbor-sq', 'Harbor Square', {lines: ['blue']});
access('harbor-sq', 'blue', 'st-harbor-sq', {escalators: [['ES-21', 'Harbor Square escalator A'], ['ES-22', 'Harbor Square escalator B']], elevators: [['EL-21', 'Harbor Square elevator']]});
station('st-mill', 'Mill Street', {lines: ['blue']});
access('mill', 'blue', 'st-mill', {escalators: [['ES-31', 'Mill Street escalator']], elevators: [['EL-31', 'Mill Street elevator']]});
station('st-airport', 'Ashford Airport', {lines: ['blue']});
access('airport', 'blue', 'st-airport', {escalators: [['ES-41', 'Airport escalator']], elevators: [['EL-41', 'Airport elevator, terminal side'], ['EL-42', 'Airport elevator, garage side']], ramps: [['RP-41', 'Airport ramp']]});
station('st-westgate', 'Westgate', {lines: ['red']});
access('westgate', 'red', 'st-westgate', {escalators: [['ES-51', 'Westgate escalator']], elevators: [['EL-51', 'Westgate elevator']]});
station('st-union-park', 'Union Park', {lines: ['red'], stepFree: false});
access('union-park', 'red', 'st-union-park', {escalators: [['ES-61', 'Union Park escalator north'], ['ES-62', 'Union Park escalator south']]});
for (const [id, name] of [['st-quarry', 'Quarry'], ['st-lakeside', 'Lakeside'], ['st-northfield', 'Northfield']]) stop(id, name + ' (at-grade rail stop)');
for (const [id, name] of [['st-elm-3rd', 'Elm & 3rd'], ['st-elm-4th', 'Elm & 4th'], ['st-ash', 'Ash Street'], ['st-pine-2nd', 'Pine & 2nd'], ['st-birch', 'Birch Avenue'],
  ['st-market-5th', 'Market & 5th'], ['st-oak-9th', 'Oak & 9th'], ['st-library', 'Central Library'], ['st-river', 'River Street'], ['st-canal', 'Canal Street'],
  ['st-dock', 'Dock Road'], ['st-harbor-blvd', 'Harbor Boulevard'], ['st-harbor-sq-bus', 'Harbor Square (bus)'], ['st-bayview', 'Bayview Loop'],
  ['st-seaport', 'Seaport'], ['st-lighthouse', 'Lighthouse Point']]) stop(id, name);
// Same-corner transfers.
path('pw-elm-corner', 'st-elm-3rd', 'st-elm-4th', 'walkway', 120, 150);

const routes = [
  {route_id: 'rt-blue', short_name: 'blue', name: 'Blue Line', mode: 'rail'},
  {route_id: 'rt-red', short_name: 'red', name: 'Red Line', mode: 'rail'},
  {route_id: 'rt-12', short_name: '12', name: 'Bus 12', mode: 'bus'},
  {route_id: 'rt-40', short_name: '40', name: 'Bus 40', mode: 'bus'}
];
const seq = list => list.map(([node_id, offset_min]) => ({node_id, offset_min}));
const f = (start, end, headway_min) => ({start, end, headway_min});
const patterns = [
  {pattern_id: 'pt-blue-nb', route_id: 'rt-blue', direction: 'nb', headsign: 'Airport',
    stops: seq([['central-blue', 0], ['harbor-sq-blue', 3], ['mill-blue', 7], ['airport-blue', 16]]),
    frequencies: {weekday: [f('05:04', '23:58', 6)], saturday: [f('06:00', '23:50', 10)], sunday: [f('07:00', '23:00', 12)]}},
  {pattern_id: 'pt-blue-sb', route_id: 'rt-blue', direction: 'sb', headsign: 'Central',
    stops: seq([['airport-blue', 0], ['mill-blue', 9], ['harbor-sq-blue', 13], ['central-blue', 16]]),
    frequencies: {weekday: [f('05:00', '23:54', 6)], saturday: [f('06:05', '23:55', 10)], sunday: [f('07:06', '23:06', 12)]}},
  {pattern_id: 'pt-red-nb', route_id: 'rt-red', direction: 'nb', headsign: 'Northfield',
    stops: seq([['st-quarry', 0], ['union-park-red', 5], ['central-red', 10], ['westgate-red', 16], ['st-lakeside', 20], ['st-northfield', 24]]),
    frequencies: {weekday: [f('05:00', '23:52', 8)], saturday: [f('06:00', '23:48', 12)], sunday: [f('07:00', '23:00', 15)]}},
  {pattern_id: 'pt-red-sb', route_id: 'rt-red', direction: 'sb', headsign: 'Quarry',
    stops: seq([['st-northfield', 0], ['st-lakeside', 4], ['westgate-red', 8], ['central-red', 14], ['union-park-red', 19], ['st-quarry', 24]]),
    frequencies: {weekday: [f('05:04', '23:56', 8)], saturday: [f('06:06', '23:54', 12)], sunday: [f('07:07', '23:07', 15)]}},
  {pattern_id: 'pt-12-nb', route_id: 'rt-12', direction: 'nb', headsign: 'Central',
    stops: seq([['st-elm-3rd', 0], ['st-ash', 3], ['st-market-5th', 6], ['st-oak-9th', 8], ['st-library', 10], ['central-bay', 12]]),
    frequencies: {weekday: [f('05:30', '23:30', 10)], saturday: [f('06:00', '23:30', 15)], sunday: [f('07:00', '23:00', 20)]}},
  {pattern_id: 'pt-12-sb', route_id: 'rt-12', direction: 'sb', headsign: 'Elm & 3rd',
    stops: seq([['central-bay', 0], ['st-library', 2], ['st-oak-9th', 4], ['st-market-5th', 6], ['st-ash', 9], ['st-elm-3rd', 12]]),
    frequencies: {weekday: [f('05:40', '23:40', 10)], saturday: [f('06:10', '23:40', 15)], sunday: [f('07:10', '23:10', 20)]}},
  // Bus 40: the full route every 30 min, plus a weekday-peak short turn from Market & 5th.
  {pattern_id: 'pt-40-nb', route_id: 'rt-40', direction: 'nb', headsign: 'Lighthouse Point',
    stops: seq([['st-elm-3rd', 0], ['st-pine-2nd', 4], ['st-birch', 7], ['st-market-5th', 10], ['st-river', 14], ['st-canal', 18], ['st-dock', 23],
      ['st-harbor-blvd', 28], ['st-harbor-sq-bus', 38], ['st-bayview', 46], ['st-seaport', 52], ['st-lighthouse', 58]]),
    frequencies: {weekday: [f('05:41', '22:41', 30)], saturday: [f('06:41', '22:41', 30)], sunday: [f('07:41', '21:41', 60)]}},
  {pattern_id: 'pt-40-nb-short', route_id: 'rt-40', direction: 'nb', headsign: 'Lighthouse Point (from Market & 5th)',
    stops: seq([['st-market-5th', 0], ['st-river', 4], ['st-canal', 8], ['st-dock', 13], ['st-harbor-blvd', 18], ['st-harbor-sq-bus', 28], ['st-bayview', 36],
      ['st-seaport', 42], ['st-lighthouse', 48]]),
    frequencies: {weekday: [f('06:56', '09:26', 30), f('15:56', '18:26', 30)], saturday: [], sunday: []}},
  {pattern_id: 'pt-40-sb', route_id: 'rt-40', direction: 'sb', headsign: 'Elm & 3rd',
    stops: seq([['st-lighthouse', 0], ['st-seaport', 6], ['st-bayview', 12], ['st-harbor-sq-bus', 20], ['st-harbor-blvd', 30], ['st-dock', 35], ['st-canal', 40],
      ['st-river', 44], ['st-market-5th', 48], ['st-birch', 51], ['st-pine-2nd', 54], ['st-elm-3rd', 58]]),
    frequencies: {weekday: [f('05:30', '22:30', 30)], saturday: [f('06:30', '22:30', 30)], sunday: [f('07:30', '21:30', 60)]}}
];
const link = (node_id, seconds, length_m, step_free = true) => ({node_id, seconds, length_m, step_free});
const places = [
  {place_id: 'pl-elm-3rd', name: 'Elm & 3rd', kind: 'address', access: [link('st-elm-3rd', 60, 80), link('st-elm-4th', 120, 150)]},
  {place_id: 'pl-harbor-sq', name: 'Harbor Square', kind: 'landmark', access: [link('harbor-sq-entrance', 60, 70), link('st-harbor-sq-bus', 120, 150)]},
  {place_id: 'pl-westgate-clinic', name: 'Westgate Clinic', kind: 'landmark', access: [link('westgate-entrance', 90, 110)]},
  {place_id: 'pl-airport', name: 'Ashford Airport Terminal', kind: 'landmark', access: [link('airport-entrance', 120, 140)]},
  {place_id: 'pl-library', name: 'Central Library', kind: 'landmark', access: [link('st-library', 60, 60), link('central-entrance', 300, 380)]},
  {place_id: 'pl-market-hall', name: 'Market Hall', kind: 'landmark', access: [link('st-market-5th', 90, 100)]},
  {place_id: 'pl-seaport', name: 'Seaport Aquarium', kind: 'landmark', access: [link('st-seaport', 120, 150)]},
  {place_id: 'pl-union-park', name: 'Union Park Playground', kind: 'landmark', access: [link('union-park-entrance', 180, 220)]},
  {place_id: 'pl-mill-office', name: 'Mill Street Offices', kind: 'address', access: [link('mill-entrance', 90, 100)]},
  {place_id: 'pl-lakeside', name: 'Lakeside Beach', kind: 'landmark', access: [link('st-lakeside', 240, 300)]},
  {place_id: 'pl-birch-school', name: 'Birch Avenue School', kind: 'landmark', access: [link('st-birch', 60, 70)]},
  {place_id: 'pl-quarry-market', name: 'Quarry Farmers Market', kind: 'landmark', access: [link('st-quarry', 150, 180)]}
];

module.exports = {TZ, network: () => JSON.parse(JSON.stringify({stops, nodes, pathways, facilities, routes, patterns, places}))};
