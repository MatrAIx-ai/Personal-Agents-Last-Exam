'use strict';
// Edge cases: links of a deleted album, confirm on delete, the two scopes (shared vs seen) on an
// album with only an invited member, departed contributions and purged records in reads,
// make_cover on the cover, links named through album_match, and wire message IDs that survive a
// reset.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');
const plugin = require('../plugin.cjs');
const {wireId} = require('../src/notify.cjs');

function refused(f, name, args, code) {
  const before = f.revision, rows = f.data.activity.length, r = f.try(name, args);
  assert.equal(r.status, code, name + ' ' + JSON.stringify(args) + ' -> ' + r.message);
  assert.deepEqual([f.revision, f.data.activity.length], [before, rows], 'version and activity unchanged after ' + code);
  return r;
}
const link = (id, album_id, o) => ({id, album_id, created_at: '2026-11-01T10:00:00-07:00', expires_at: null, revoked_at: null, revoke_reason: null, request_id: null, ...o});

test('albums.delete revokes only the links active at that time; an expired link stays expired', () => {
  const f = fixture({mutate: d => {
    d.links.push(link('ln-exp', 'al-garden', {expires_at: '2026-11-10T10:00:00-08:00'}), link('ln-old', 'al-garden', {revoked_at: '2026-11-03T10:00:00-08:00', revoke_reason: 'revoked'}));
  }});
  const live = f.call('fernshelf.links.create', {id: 'al-garden'});
  const del = f.call('fernshelf.albums.delete', {id: 'al-garden', confirm: true});
  assert.deepEqual(del.revoked_link_ids, [live.id]);
  const byId = id => f.data.links.find(l => l.id === id);
  assert.deepEqual([byId('ln-exp').revoked_at, byId('ln-old').revoke_reason, byId(live.id).revoke_reason], [null, 'revoked', 'album_deleted']);
  assert.deepEqual(f.call('fernshelf.albums.get', {id: 'al-garden'}).album.links.map(l => [l.id, l.state]),
    [['ln-exp', 'expired'], ['ln-old', 'revoked'], [live.id, 'revoked']]);
});

test('albums.delete asks for confirm only while a joined member or an active link can see the album', () => {
  const f = fixture({mutate: d => { d.links.push(link('ln-exp', 'al-garden', {expires_at: '2026-11-10T10:00:00-08:00'})); }});
  // Only an invited member: no confirm needed.
  const a = f.call('fernshelf.albums.create', {title: 'Invited only'});
  f.call('fernshelf.albums.members.invite', {id: a.id, person_id: 'person-dana', role: 'viewer'});
  assert.equal(f.call('fernshelf.albums.delete', {id: a.id}).state, 'deleted');
  // Only an expired link: no confirm needed.
  assert.equal(f.call('fernshelf.albums.delete', {id: 'al-garden'}).state, 'deleted');
  // A joined member, or an active link: confirm needed.
  refused(f, 'fernshelf.albums.delete', {id: 'al-reunion'}, 'confirm_required');
  const b = f.call('fernshelf.albums.create', {title: 'Linked'});
  f.call('fernshelf.links.create', {id: b.id});
  refused(f, 'fernshelf.albums.delete', {id: b.id}, 'confirm_required');
});

test('an album with only an invited member: shared (exposure.get lists it, warnings, honour clears it) but seen by no one', () => {
  const f = fixture();
  const a = f.call('fernshelf.albums.create', {title: 'For Dana'});
  f.call('fernshelf.albums.update', {id: a.id, add_ids: ['it-m08']});
  f.call('fernshelf.albums.members.invite', {id: a.id, person_id: 'person-dana', role: 'viewer'});
  // exposure.get: listed as shared, with the invited member, but visible to no one.
  const ex = f.call('fernshelf.exposure.get', {id: 'it-m08'});
  assert.deepEqual([ex.albums.map(x => x.album_id), ex.albums[0].members.map(m => m.status), ex.visible, ex.visible_to], [[a.id], ['invited'], false, []]);
  assert.deepEqual(plugin.visibility(f.data, f.now).filter(r => r.item_id === 'it-m08'), [], 'the visibility rule: nobody can see it yet');
  // removals.respond with scope everywhere clears it.
  f.event(ev('removal.requested', '2026-11-20T10:00:00-08:00', {removal_id: 'rr-p1', from_person_id: 'person-lena', item_ids: ['it-m08'], scope: {type: 'everywhere'}}));
  assert.deepEqual(f.call('fernshelf.removals.respond', {id: 'rr-p1', decision: 'honor'}).cleared, [{item_id: 'it-m08', album_ids: [a.id], link_ids: []}]);
  // A write that would show it there again warns.
  const back = f.call('fernshelf.albums.update', {id: a.id, add_ids: ['it-m08']});
  assert.deepEqual(back.warnings.map(w => [w.person_id, w.item_id]), [['person-lena', 'it-m08']]);
  // Once Dana joins, the visibility rule includes her.
  f.event(ev('member.changed', '2026-11-20T10:10:00-08:00', {album_id: a.id, person_id: 'person-dana', change: 'join'}));
  assert.deepEqual(plugin.visibility(f.data, f.now).find(r => r.item_id === 'it-m08').people, ['person-dana']);
  assert.equal(f.call('fernshelf.exposure.get', {id: 'it-m08'}).visible, true);
});

test('departed contributions and purged items keep no content in reads', () => {
  const f = fixture();
  f.call('fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'ct-omar-01'});
  f.event(ev('member.changed', '2026-11-20T10:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar', change: 'leave'}));
  const al = f.call('fernshelf.albums.get', {id: 'al-reunion'}).album;
  assert.ok(!al.entries.some(e => e.id === 'ct-omar-01'));
  assert.deepEqual(al.contributions, [{id: 'ct-omar-01', person_id: 'person-omar', added_at: '2026-11-15T10:30:00-08:00', removed_at: f.now, removed_reason: 'member_left', state: 'removed'}]);
  assert.ok(!f.call('fernshelf.items.search', {album_id: 'al-reunion'}).rows.some(r => r.id === 'ct-omar-01'));
  const ex = f.call('fernshelf.exposure.get', {id: 'ct-omar-01'});
  assert.deepEqual([ex.state, ex.albums, ex.visible], ['removed', [], false]);
  assert.equal(f.call('fernshelf.items.get', {id: 'it-s0001'}).item.caption, null, 'the saved copy is mine and stays');
  // A deleted album lists its contributions the same way.
  f.call('fernshelf.albums.delete', {id: 'al-reunion', confirm: true});
  assert.deepEqual(Object.keys(f.call('fernshelf.albums.get', {id: 'al-reunion'}).album.contributions[0]).sort(), ['added_at', 'id', 'person_id', 'removed_at', 'removed_reason', 'state']);
  // Purged by the clock (it-m10), before and after the next commit stores it, and purged now (it-m07).
  const g = fixture();
  const keys = ['added_at', 'albums', 'file', 'history', 'id', 'kind', 'purge_at', 'purged_at', 'removal_history', 'removal_requests', 'stack', 'state', 'taken_at', 'trashed_at'];
  const before = g.call('fernshelf.items.get', {id: 'it-m10'}).item;
  assert.deepEqual(Object.keys(before).sort(), keys);
  g.call('fernshelf.items.trash', {ids: ['it-m07']});
  g.call('fernshelf.items.purge', {ids: ['it-m07'], confirm: true});
  assert.deepEqual(g.call('fernshelf.items.get', {id: 'it-m10'}).item, before, 'storing the purge changes nothing a read returns');
  const stored = g.data.items.find(i => i.id === 'it-m10');
  assert.deepEqual([stored.state, stored.caption, stored.people, stored.place, stored.content_hash, stored.file], ['purged', null, [], null, null, null]);
  assert.deepEqual(Object.keys(g.call('fernshelf.items.get', {id: 'it-m07'}).item).sort(), keys);
  const rows = g.call('fernshelf.items.search', {state: 'purged'}).rows;
  assert.deepEqual(rows.map(r => r.id), ['it-m07', 'it-m10']);
  assert.ok(rows.every(r => !('caption' in r) && !('people' in r) && !('place' in r) && !('declared_bytes' in r)));
  assert.deepEqual(g.call('fernshelf.items.search', {state: 'purged', source: 'screenshot'}).rows, [], 'only time and kind filter purged records');
  assert.deepEqual(g.call('fernshelf.items.search', {state: 'purged', kind: 'photo', start: '2026-11-01'}).rows.map(r => r.id), ['it-m07']);
});

test('make_cover on the item that is already the cover is refused and writes nothing', () => {
  const f = fixture();
  refused(f, 'fernshelf.items.update', {id: 'it-m01', patch: {make_cover: true}}, 'invalid_arguments');
  refused(f, 'fernshelf.items.update', {id: 'it-m01', patch: {favorite: true, make_cover: true}}, 'invalid_arguments');
  assert.equal(f.call('fernshelf.items.update', {id: 'it-m02', patch: {make_cover: true}}).cover_id, 'it-m02');
});

test('a link named through album_match resolves to the newest matching album that has an active link', () => {
  const f = fixture();
  const older = f.call('fernshelf.albums.create', {title: 'Trip'}), newer = f.call('fernshelf.albums.create', {title: 'Trip'});
  for (const a of [older, newer]) f.call('fernshelf.albums.update', {id: a.id, add_ids: ['it-m07']});
  const view = (view_id, at) => ev('share.viewed', at, {view_id, surface: {type: 'link', album_match: {title: 'trip'}}, viewer: {anonymous: true}, viewed_item_ids: 'all'});
  const none = f.tryEvent(view('vw-a', '2026-11-20T10:00:00-08:00'));
  assert.equal(none.status, 'invalid_event');
  assert.match(none.message, /no album with an active link/);
  const l1 = f.call('fernshelf.links.create', {id: older.id});
  f.event(view('vw-b', '2026-11-20T10:05:00-08:00'));
  assert.deepEqual(f.data.views.at(-1).surface, {type: 'link', album_id: older.id, link_id: l1.id}, 'the newer album has no link');
  const l2 = f.call('fernshelf.links.create', {id: newer.id});
  f.event(view('vw-c', '2026-11-20T10:10:00-08:00'));
  assert.equal(f.data.views.at(-1).surface.link_id, l2.id, 'both have one: the newest album');
  // Named by album_id, an album without an active link is still rejected.
  f.call('fernshelf.links.revoke', {id: l2.id});
  assert.equal(f.tryEvent(ev('share.viewed', '2026-11-20T10:15:00-08:00', {view_id: 'vw-d', surface: {type: 'link', album_id: newer.id}, viewer: {anonymous: true}, viewed_item_ids: 'all'})).status, 'invalid_event');
});

test('wire message IDs: the same notification keeps its ID, a different one that reuses the notification ID gets another', () => {
  const n = {id: 'ntf-0002', kind: 'removal.requested', at: '2026-11-20T10:00:00-08:00', object_type: 'removal_request', object_id: 'rr-1', title: 'T', body: 'B', event_id: 'ev-1'};
  assert.equal(wireId(n), wireId({...n}));
  assert.match(wireId(n), /^fernshelf-ntf-0002-[0-9a-f]{16}$/);
  assert.notEqual(wireId(n), wireId({...n, event_id: 'ev-2'}));
  assert.notEqual(wireId(n), wireId({...n, body: 'C'}));
});
