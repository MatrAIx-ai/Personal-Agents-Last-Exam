'use strict';
// App-only walkthrough: apply the approved edition.publish example and show the Valley front page change.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const page = () => f.call('dayline.front_page.get', {front_page_id: 'local'}).entries.map(e => e.position + '. ' + e.edition_id + ' (' + e.outlet_name + ')');
const before = page();
f.event(require('./scenario.json'));
const after = page();
assert.notDeepEqual(after, before);
assert.equal(after[0], '1. rail-local-2 (Valley Daily)');
const saved = f.call('dayline.saved.add', {edition_id: 'gulls-recap-1'});
console.log(JSON.stringify({app: 'dayline', local_front_page: {before, after}, save_result: saved,
  reading_list: f.call('dayline.saved.list', {}).entries.map(e => e.edition.edition_id)}, null, 2));
