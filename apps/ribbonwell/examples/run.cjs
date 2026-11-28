'use strict';
// A short walk through real state changes: an owner adds an item (event), the bound member
// reserves it, time passes with no App event, and the hold reads as lapsed.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
const claim = f.call('claims.reserve', {id: 'itm-tomas-031', quantity: 1});
const held = f.call('items.get', {id: 'itm-tomas-031'}).item;
f.advance('2026-12-09T08:00:00-05:00');
const later = f.call('items.get', {id: 'itm-tomas-031'}).item;
assert.equal(held.remaining, 1); assert.equal(later.remaining, 2); assert.equal(later.claims[0].status, 'lapsed');
console.log(JSON.stringify({app: 'ribbonwell', event: 'ribbonwell.item.added', reserved_until: claim.reserved_until,
  remaining_while_held: held.remaining, remaining_after_lapse: later.remaining, claim_status_after_lapse: later.claims[0].status,
  notifications_added: f.data.notifications.length - before.notifications.length, activity_rows_added: f.data.activity.length - before.activity.length}, null, 2));
