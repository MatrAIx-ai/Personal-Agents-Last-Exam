'use strict';
// Builders for the core examples (proposal §2). Times are America/New_York, EST (-05:00) in December 2026.
let seq = 0;
const ev = (at, operation, payload) => ({event_id: 'ev-' + (++seq), at, operation, payload});
const T = (monthDay, hhmm) => `2026-${monthDay}T${hhmm}:00-05:00`;
const el12Out = (at = T('12-07', '06:40'), extra = {}) => ev(at, 'facility.status_changed', {facility_id: 'fac-el12', stop_id: 'st-central', status: 'out_of_service',
  since: at, expected_return: T('12-08', '18:00'), note: 'Door fault', ...extra});
const tap = (at, card_id, key, extra = {}) => {
  const [stop_id, route_id, mode] = {rail: ['st-harbor-sq', 'rt-blue', 'rail'], central: ['st-central', 'rt-blue', 'rail'], bus: ['st-elm-3rd', 'rt-40', 'bus'], bus12: ['st-elm-3rd', 'rt-12', 'bus']}[key];
  return ev(at, 'fare.tap_recorded', {tap_id: 'tp-' + (++seq), card_id, stop_id, route_id, mode, ...extra});
};
const plan = (f, extra = {}) => f.call('hopline.trips.plan', {from: 'pl-elm-3rd', to: 'pl-harbor-sq', ...extra});
const rides = it => it.legs.filter(l => l.kind === 'ride').map(l => l.trip_id);
module.exports = {ev, T, el12Out, tap, plan, rides};
