'use strict';
// App-only walkthrough on the minimal fixture: read a forecast, apply the example event, see the rule fire.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

const f = fixture();
const forecast = f.call('gustline.forecast.get', {place_id: 'pl-dunes', from: '2027-10-08T12:00:00-06:00',
  to: '2027-10-08T18:00:00-06:00', granularity: 'hourly', provider: 'regional_office'});
const before = f.call('gustline.air.current', {place_id: 'pl-school'});
f.event(require('./scenario.json'));
const after = f.call('gustline.air.current', {place_id: 'pl-school'});
// The fixture also carries the account's history since 2025; this walkthrough looks at the new notice.
const notifications = f.call('gustline.notifications.list', {status: 'pending_delivery'}).notifications;
assert.equal(after.aqi, 132);
assert.equal(notifications.length, 1);
assert.equal(notifications[0].status, 'pending_delivery');
console.log(JSON.stringify({
  app: 'gustline',
  forecast: {issuance_id: forecast.issuance_id, as_of: forecast.as_of, other_providers: forecast.other_providers_available,
    afternoon_precip_prob_pct: forecast.periods.map(p => [p.start, p.precip_prob_pct])},
  air_before: {aqi: before.aqi, category: before.category, observed_at: before.observed_at},
  event: require('./scenario.json').operation,
  air_after: {aqi: after.aqi, category: after.category, averaging: Object.fromEntries(Object.entries(after.pollutants).map(([k, v]) => [k, v.averaging]))},
  notification: {id: notifications[0].notification_id, trigger_key: notifications[0].trigger_key, status: notifications[0].status,
    title: notifications[0].title, body: notifications[0].body}
}, null, 2));
