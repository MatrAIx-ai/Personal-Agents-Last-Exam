'use strict';
// Walkthrough on fresh synthetic data (the reference library): Maya makes an album for Iris with
// two reunion photos, invites her and shares a link. Iris joins through an event that names the
// new album by what it holds (album_match), views the link and saves one photo. Then Dana asks
// that three reunion photos be taken down from Reunion 2026 (examples/scenario.json). Honouring it
// clears that album and its link at once, leaves Omar's contribution alone (not_removable), keeps
// the new album as it is (the request named Reunion 2026 only), and lists what was already seen
// and saved. Adding one of the photos to a shared album afterwards returns a removal_honored warning.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture({seed: 'reference'});
const album = f.call('fernshelf.albums.create', {title: 'For Iris'});
f.call('fernshelf.albums.update', {id: album.id, add_ids: ['it-2611-0934', 'it-2611-0942']});
f.call('fernshelf.albums.members.invite', {id: album.id, person_id: 'person-iris', role: 'viewer'});
const link = f.call('fernshelf.links.create', {id: album.id, expires_at: '2026-11-27T09:00:00-08:00'});
f.event({event_id: 'ev-fs-412', at: '2026-11-20T10:00:00-08:00', operation: 'fernshelf.member.changed',
  payload: {album_match: {contains_item_ids: ['it-2611-0934']}, person_id: 'person-iris', change: 'join'}});
f.event({event_id: 'ev-fs-431', at: '2026-11-20T12:00:00-08:00', operation: 'fernshelf.share.viewed',
  payload: {view_id: 'vw-0431', surface: {type: 'link', album_match: {person_id: 'person-iris'}}, viewer: {person_id: 'person-iris'},
    viewed_item_ids: 'all', saved_item_ids: ['it-2611-0934']}});
const before = f.call('fernshelf.exposure.get', {id: 'it-2611-0934'});
f.event(require('./scenario.json'));
const answer = f.call('fernshelf.removals.respond', {id: 'rr-0007', decision: 'honor', note: 'Taken down from Reunion 2026.'});
const after = f.call('fernshelf.exposure.get', {id: 'it-2611-0934'});
const again = f.call('fernshelf.albums.update', {id: 'al-family-2026', add_ids: ['it-2611-0931']});
assert.equal(f.data.activity.find(a => a.event_id === 'ev-fs-412').details.album_id, album.id);
assert.deepEqual(answer.cleared.map(c => [c.item_id, c.album_ids, c.link_ids]), [['it-2611-0931', ['al-reunion-2026'], ['ln-0012']], ['it-2611-0934', ['al-reunion-2026'], ['ln-0012']]]);
assert.deepEqual(answer.not_removable, ['ct-omar-0007']);
assert.deepEqual(after.albums.map(a => a.album_id), ['al-family-2026', album.id]);
assert.deepEqual(again.warnings.map(w => [w.item_id, w.person_id]), [['it-2611-0931', 'person-dana']]);
console.log(JSON.stringify({app: 'fernshelf', album, link: {id: link.id, expires_at: link.expires_at},
  joined_album: f.data.activity.find(a => a.event_id === 'ev-fs-412').details.album_id,
  exposure_before: before.albums.map(a => ({album_id: a.album_id, visible_to: a.visible_to, links: a.links.map(l => l.link_id)})),
  answer: {state: answer.state, cleared: answer.cleared, not_removable: answer.not_removable,
    already_seen: answer.already_seen.map(x => ({item_id: x.item_id, views: x.views.map(v => (v.viewer.display_name || 'anonymous') + ' at ' + v.at),
      saves: x.saves.map(v => (v.viewer.display_name || 'anonymous') + ' at ' + v.at)}))},
  exposure_after: after.albums.map(a => ({album_id: a.album_id, visible_to: a.visible_to})),
  later_write_warnings: again.warnings, notifications: f.data.notifications.slice(-2).map(n => ({kind: n.kind, title: n.title})),
  activity_rows: f.data.activity.length}, null, 2));
