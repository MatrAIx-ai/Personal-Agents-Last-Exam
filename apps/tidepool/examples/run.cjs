'use strict';
// App-only walkthrough: apply the approved kitchen-speaker listening.record example, then line up
// Priya's commute (example request 1) and show that only her progress changed.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const progress = () => f.call('tidepool.progress.get', {id: 'mem-priya', episode_ids: ['ep-fieldnotes-112', 'ep-fieldnotes-113']}).progress
  .map(p => p.episode_id + ': ' + p.state + (p.state === 'in_progress' ? ' at ' + p.position_s + ' s' : ''));
const sam113 = () => f.data.progress.find(p => p.member_id === 'mem-sam' && p.episode_id === 'ep-fieldnotes-113');
const before = progress(), samBefore = sam113();
f.event(require('./scenario.json'));
const after = progress();
assert.deepEqual(after, ['ep-fieldnotes-112: in_progress at 1870 s', 'ep-fieldnotes-113: played']);
assert.deepEqual(sam113(), samBefore, 'the kitchen speaker session leaves Sam\'s progress alone');
const queue = f.call('tidepool.upnext.set', {id: 'mem-priya', episode_ids: ['ep-fieldnotes-112', 'ep-harborhours-088'], expected_list_version: 1});
const downloads = ['ep-fieldnotes-112', 'ep-harborhours-088'].map(item_id =>
  f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id}));
const upnext = f.call('tidepool.upnext.get', {id: 'mem-priya'});
console.log(JSON.stringify({app: 'tidepool', progress: {before, after}, sam_progress_on_113: sam113(), up_next_version: queue.list_version,
  up_next: upnext.entries.map(e => e.episode_id + ' (' + e.remaining_s + ' s left)'), total_remaining_minutes: Math.round(upnext.total_remaining_s / 60),
  downloads: downloads.map(d => ({download_id: d.download_id, item_id: d.item_id, status: d.download_status, completes_at: d.completes_at})),
  activity_rows: f.data.activity.length}, null, 2));
