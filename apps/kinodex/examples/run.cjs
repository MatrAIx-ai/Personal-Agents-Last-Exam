'use strict';
// App-only walkthrough: apply the approved title.update example (Lantern Hill guide version 2) and show
// the spoiler-safe guide and where the film can be watched the next evening.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const guide = hide => f.call('kinodex.guide.get', {title_id: 'tt-lantern-hill', hide_spoilers: hide}).guide;
const frightening = g => ({version: g.version, severity: g.categories.frightening.severity, summary: g.categories.frightening.summary,
  items: g.categories.frightening.items.map(i => i.text), withheld_items: g.categories.frightening.withheld_items});
const before = frightening(guide(true));
f.event(require('./scenario.json'));
const after = frightening(guide(true));
assert.deepEqual([before.version, before.severity, after.version, after.severity], [1, 'mild', 2, 'moderate']);
assert.equal(after.withheld_items, 1);
f.advance('2026-12-05T19:00:00-08:00');
const offers = f.call('kinodex.offers.for_title', {title_id: 'tt-lantern-hill', region: 'US'}).result.offers
  .map(o => [o.service_name, o.type, o.availability, o.available_until, o.price]);
assert.deepEqual(offers[0], ['Brightreel', 'subscription', 'leaving_soon', '2026-12-05T23:59:00-08:00', null]);
console.log(JSON.stringify({app: 'kinodex', title: 'Lantern Hill', certification_us: f.call('kinodex.titles.get', {title_id: 'tt-lantern-hill'}).title.certification,
  frightening_spoilers_hidden: {before, after}, offers_us_at: '2026-12-05T19:00:00-08:00', offers,
  activity: f.data.activity.map(a => [a.seq, a.actor, a.action, a.event_id])}, null, 2));
