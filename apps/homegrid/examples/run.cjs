'use strict';
// App-only walkthrough on the minimal fixture: preview Sam's move, place it, then apply the example
// boil-water advisory and see the health notice bypass quiet hours.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

const f = fixture();
const preview = f.call('homegrid.orders.preview', {type: 'transfer', from_premise_id: 'pr-maple-22', to_premise_id: 'pr-linden-14',
  stop_date: '2027-01-15', start_date: '2027-01-15'});
const order = f.call('homegrid.orders.create', {order_token: preview.order_token});
f.call('homegrid.preferences.update', {quiet_hours: {start: '22:00', end: '09:30'}});
f.event(require('./scenario.json'));
const advisory = f.call('homegrid.advisories.list', {premise_id: 'pr-maple-22'}).advisories[0];
const n = f.call('homegrid.notifications.list', {type: 'advisory'}).notifications[0];
assert.deepEqual(preview.warnings.internet, {service_gap_days: 3});
assert.equal(n.status, 'pending_delivery');
console.log(JSON.stringify({
  app: 'homegrid',
  preview: {as_of: preview.as_of, warnings: preview.warnings, deposit_cents: preview.deposit_cents,
    internet_earliest_window: preview.parts.find(p => p.type === 'start' && p.service_type === 'internet').earliest_window},
  order,
  event: require('./scenario.json').operation,
  advisory: {advisory_id: advisory.advisory_id, status: advisory.status, latest_version: advisory.latest_version},
  notification: {id: n.notification_id, trigger_key: n.trigger_key, status: n.status, health: n.health, title: n.title, body: n.body}
}, null, 2));
