'use strict';
// Walkthrough on fresh synthetic data: Maya makes an album, adds two reunion photos, invites Kofi
// and shares a link. Kofi joins through an event that names the new album by what it holds
// (album_match), views the link and saves one photo. Then Kofi asks that one photo be taken down
// (examples/scenario.json); honouring it clears the album and its link at once, and the result
// lists the save that cannot be undone.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture({now: '2026-11-20T09:00:00-08:00'});
const album = f.call('fernshelf.albums.create', {title: 'Reunion picks'});
f.call('fernshelf.albums.update', {id: album.id, add_ids: ['it-m03', 'it-m13']});
const kofi = f.call('fernshelf.albums.members.invite', {id: album.id, person_id: 'person-kofi', role: 'viewer'});
const link = f.call('fernshelf.links.create', {id: album.id, expires_at: '2026-11-27T09:00:00-08:00'});
f.event({event_id: 'ev-fs-410', at: '2026-11-20T10:00:00-08:00', operation: 'fernshelf.member.changed',
  payload: {album_match: {contains_item_ids: ['it-m03', 'it-m13']}, person_id: 'person-kofi', change: 'join'}});
f.event({event_id: 'ev-fs-430', at: '2026-11-20T12:00:00-08:00', operation: 'fernshelf.share.viewed',
  payload: {view_id: 'vw-0430', surface: {type: 'link', album_match: {person_id: 'person-kofi'}}, viewer: {person_id: 'person-kofi'},
    viewed_item_ids: 'all', saved_item_ids: ['it-m03']}});
const before = f.call('fernshelf.exposure.get', {id: 'it-m03'});
f.event(require('./scenario.json'));
const pending = f.call('fernshelf.removals.list', {state: 'pending'}).removals.find(r => r.id === 'rr-0440');
const answer = f.call('fernshelf.removals.respond', {id: 'rr-0440', decision: 'honor', note: 'Taken down from the reunion album.'});
const after = f.call('fernshelf.exposure.get', {id: 'it-m03'});
assert.deepEqual(before.albums.map(a => a.album_id).sort(), ['al-reunion', album.id].sort());
assert.deepEqual(answer.cleared, [{item_id: 'it-m03', album_ids: ['al-reunion'], link_ids: ['ln-m1']}]);
assert.deepEqual(after.albums.map(a => a.album_id), [album.id], 'the request named al-reunion only');
assert.deepEqual([answer.already_seen[0].views.length, answer.already_seen[0].saves.length], [2, 1], 'Kofi saw it twice and saved it once through the new link: that cannot be undone');
console.log(JSON.stringify({app: 'fernshelf', album, invite: kofi, link,
  joined_album: f.data.activity.find(a => a.event_id === 'ev-fs-410').details.album_id,
  exposure_before: before.albums.map(a => ({album_id: a.album_id, visible_to: a.visible_to, links: a.links.map(l => l.link_id)})),
  request: {id: pending.id, state: pending.state, not_removable: pending.not_removable}, answer,
  exposure_after: after.albums.map(a => ({album_id: a.album_id, visible_to: a.visible_to})),
  notifications: f.data.notifications.map(n => ({kind: n.kind, title: n.title})), activity_rows: f.data.activity.length}, null, 2));
