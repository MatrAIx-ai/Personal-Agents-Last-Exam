'use strict';
// App-only walkthrough on the minimal fixture: EL-12 fails at Central, Dana's step-free commute subscription
// fires, and a step-free plan avoids Central and names the elevator as the blocker.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

const f = fixture();
f.event(require('./scenario.json'));
f.advance('2026-12-07T07:30:00-05:00');
const plan = f.call('hopline.trips.plan', {from: 'pl-elm-3rd', to: 'pl-harbor-sq', depart_at: '2026-12-07T07:35:00-05:00', step_free: true, card_id: 'cd-dana'});
const n = f.call('hopline.notifications.list').notifications[0];
assert.equal(plan.itineraries[0].arrive, '2026-12-07T08:21:00-05:00');
assert.equal(n.notification_id, 'n-sub3-fac-el12-1-dana');
console.log(JSON.stringify({
  app: 'hopline',
  event: require('./scenario.json').operation,
  plan: {as_of: plan.as_of, itineraries: plan.itineraries.map(i => ({arrive: i.arrive, step_free: i.step_free, fare_cents: i.fare.total_cents,
    rides: i.legs.filter(l => l.kind === 'ride').map(l => l.trip_id)})), blockers: plan.blockers, facilities: plan.service_state.facilities},
  notification: {id: n.notification_id, trigger_key: n.trigger_key, status: n.status, title: n.title, body: n.body}
}, null, 2));
