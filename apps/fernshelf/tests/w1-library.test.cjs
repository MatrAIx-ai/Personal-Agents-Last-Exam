'use strict';
// W1 Library, search and storage (read-only): T01-T05 on the small hand-authored seed.
// The acceptance rows on the reference fixture are in fixtures.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');
const plugin = require('../plugin.cjs');

const ids = rows => rows.map(r => r.id);
const search = (f, args) => f.call('fernshelf.items.search', args);

test('T01 search: each filter alone and combined, local-day windows across a time-zone boundary, stacks, pagination and order', () => {
  const f = fixture();
  const all = search(f, {});
  // Active items only (it-m09 is trashed; it-m10's purge_at has passed, so it reads purged); stacks collapsed to their cover.
  assert.deepEqual(ids(all.rows), ['it-m03', 'it-m01', 'it-m07', 'it-m12', 'it-m05', 'it-m06', 'it-m08', 'it-m13']);
  assert.equal(all.total, 8);
  const burst = all.rows.find(r => r.id === 'it-m01');
  assert.deepEqual([burst.stack_id, burst.stack_size, burst.is_cover, burst.matched_versions, burst.stack_kind], ['st-m1', 2, true, 2, 'burst']);
  assert.deepEqual([all.rows.find(r => r.id === 'it-m03').stack_id, all.rows.find(r => r.id === 'it-m03').stack_size], [null, null]);
  const flat = search(f, {collapse_stacks: false});
  assert.deepEqual(ids(flat.rows), ['it-m03', 'it-m02', 'it-m01', 'it-m07', 'it-m12', 'it-m04', 'it-m05', 'it-m06', 'it-m08', 'it-m13']);
  assert.equal(flat.rows.find(r => r.id === 'it-m02').is_cover, false);
  // Each filter alone.
  assert.deepEqual(ids(search(f, {label_id: 'pl-dana'}).rows), ['it-m01']);
  assert.deepEqual(ids(search(f, {label_id: 'pl-dana', collapse_stacks: false}).rows), ['it-m02', 'it-m01']);
  assert.deepEqual(ids(search(f, {place: 'alder'}).rows), ['it-m03', 'it-m01']);
  assert.deepEqual(ids(search(f, {kind: 'video'}).rows), ['it-m06']);
  assert.deepEqual(ids(search(f, {source: 'screenshot'}).rows), ['it-m07', 'it-m12']);
  assert.deepEqual(ids(search(f, {source: 'download'}).rows), ['it-m08']);
  assert.deepEqual(ids(search(f, {favorite: true}).rows), ['it-m05']);
  assert.deepEqual(ids(search(f, {archived: true}).rows), []);
  assert.deepEqual(ids(search(f, {backed_up: false}).rows), []);
  assert.deepEqual(ids(search(f, {min_bytes: 100000000}).rows), ['it-m06']);
  assert.deepEqual(ids(search(f, {text: 'CAKE'}).rows), ['it-m03']);
  assert.deepEqual(ids(search(f, {album_id: 'al-reunion'}).rows), ['it-m03', 'it-m01'], 'a member\'s contribution is not my item');
  assert.deepEqual(ids(search(f, {state: 'trashed'}).rows), ['it-m09']);
  assert.deepEqual(ids(search(f, {state: 'purged'}).rows), ['it-m10']);
  // A stack whose cover does not match is represented by its matching version.
  const original = search(f, {label_id: 'pl-ruth', favorite: false});
  assert.deepEqual(ids(original.rows), ['it-m04', 'it-m13']);
  assert.deepEqual([original.rows[0].is_cover, original.rows[0].matched_versions, original.rows[0].stack_size], [false, 1, 2]);
  // Combined filters.
  assert.deepEqual(ids(search(f, {label_id: 'pl-ruth', favorite: true, place: 'garden'}).rows), ['it-m05']);
  assert.deepEqual(ids(search(f, {start: '2026-11-01', end: '2026-11-30', kind: 'photo', source: 'camera'}).rows), ['it-m03', 'it-m01']);
  // Local days in America/Los_Angeles: it-m13 was taken 2025-12-31 23:30 local, which is 2026-01-01 in UTC.
  assert.deepEqual(ids(search(f, {start: '2025-12-31', end: '2025-12-31'}).rows), ['it-m13']);
  assert.deepEqual(ids(search(f, {start: '2026-01-01', end: '2026-01-01'}).rows), []);
  assert.deepEqual(ids(search(f, {start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z'}).rows), ['it-m13']);
  assert.equal(search(f, {start: '2026-01-01T00:00:00Z'}).rows.find(r => r.id === 'it-m13').local_date, '2025-12-31');
  // A window across the autumn daylight-saving change (1 November 2026) still covers whole local days.
  assert.deepEqual(ids(search(f, {start: '2026-11-01', end: '2026-11-01'}).rows), ['it-m07', 'it-m12']);
  // Pagination with a stable order (newest capture first, then ID).
  const p1 = search(f, {limit: 3}), p2 = search(f, {limit: 3, cursor: p1.next_cursor}), p3 = search(f, {limit: 3, cursor: p2.next_cursor});
  assert.deepEqual([...ids(p1.rows), ...ids(p2.rows), ...ids(p3.rows)], ids(all.rows));
  assert.deepEqual([p1.next_cursor, p2.next_cursor, p3.next_cursor], ['3', '6', null]);
  assert.deepEqual(ids(search(f, {limit: 3}).rows), ids(p1.rows), 'same query, same page');
  // Errors.
  assert.equal(f.try('fernshelf.items.search', {start: '2026-11-10', end: '2026-11-01'}).status, 'invalid_window');
  assert.equal(f.try('fernshelf.items.search', {start: '2026-11-10T10:00:00Z', end: '2026-11-10T09:00:00Z'}).status, 'invalid_window');
  assert.equal(f.try('fernshelf.items.search', {label_id: 'pl-nobody'}).status, 'not_found');
  assert.equal(f.try('fernshelf.items.search', {album_id: 'al-nowhere'}).status, 'not_found');
  assert.equal(f.try('fernshelf.items.search', {start: '2026-13-01'}).status, 'invalid_arguments');
  assert.deepEqual(f.audit.filter(a => a.decision === 'deny').map(a => a.reason), ['invalid_window', 'invalid_window', 'not_found', 'not_found', 'invalid_arguments']);
});

test('T02 account, items, albums and notifications reads', () => {
  const f = fixture();
  const acc = f.call('fernshelf.account.get');
  assert.equal(acc.account.account_id, 'fernshelf-maya');
  assert.deepEqual([acc.account.quota_bytes, acc.account.trash_retention_days, acc.account.time_zone, acc.account.email_notices], [15e9, 30, 'America/Los_Angeles', false]);
  const count = id => acc.labels.find(l => l.id === id).item_count;
  assert.deepEqual([count('pl-dana'), count('pl-ruth'), count('pl-maya'), count('pl-omar'), count('pl-pip')], [2, 3, 3, 0, 1]);
  assert.equal(acc.labels.find(l => l.id === 'pl-pip').person_id, null);
  assert.equal(acc.people.length, 5);
  // items.get with its stack (every version, the edit as cover), albums, history and removal requests.
  const edited = f.call('fernshelf.items.get', {id: 'it-m04'}).item;
  assert.equal(edited.stack.id, 'st-m2');
  assert.deepEqual(edited.stack.versions.map(v => [v.id, v.is_cover, v.declared_bytes, v.kind, v.state]),
    [['it-m04', false, 5120000, 'photo', 'active'], ['it-m05', true, 5300000, 'photo', 'active']]);
  assert.deepEqual(edited.albums, []);
  const cover = f.call('fernshelf.items.get', {id: 'it-m05'}).item;
  assert.deepEqual(cover.albums.map(a => [a.album_id, a.album_state, a.shows_item, a.has_audience]), [['al-garden', 'private', true, false]]);
  const shared = f.call('fernshelf.items.get', {id: 'it-m01'}).item;
  assert.deepEqual(shared.removal_requests.map(r => [r.id, r.state, r.scope.album_id]), [['rr-m1', 'pending', 'al-reunion']]);
  assert.deepEqual(shared.history.map(h => h.action), ['added']);
  assert.deepEqual(shared.file, null);
  const trashed = f.call('fernshelf.items.get', {id: 'it-m09'}).item;
  assert.deepEqual([trashed.state, trashed.purge_at, trashed.albums[0].shows_item], ['trashed', '2026-12-10T20:00:00-08:00', false]);
  const purged = f.call('fernshelf.items.get', {id: 'it-m10'}).item;
  assert.deepEqual([purged.state, purged.purged_at, purged.albums, purged.stack], ['purged', '2026-11-18T08:00:00-07:00', [], null]);
  assert.equal(f.try('fernshelf.items.get', {id: 'ct-omar-01'}).status, 'not_yours');
  assert.equal(f.try('fernshelf.items.get', {id: 'it-nope'}).status, 'not_found');
  // albums.list and albums.get.
  const list = f.call('fernshelf.albums.list').albums;
  assert.deepEqual(list.map(a => [a.id, a.state, a.item_count, a.members.joined, a.members.invited, a.active_links.length]),
    [['al-reunion', 'shared', 3, 2, 0, 1], ['al-garden', 'private', 1, 0, 0, 0]]);
  const reunion = f.call('fernshelf.albums.get', {id: 'al-reunion'}).album;
  assert.deepEqual(reunion.entries.map(e => [e.id, e.mine, e.contributed_by]), [['it-m01', true, null], ['it-m03', true, null], ['ct-omar-01', false, 'person-omar']]);
  assert.deepEqual(reunion.members.map(m => [m.person_id, m.role, m.status]), [['person-kofi', 'viewer', 'joined'], ['person-omar', 'contributor', 'joined'], ['person-ruth', 'viewer', 'declined']]);
  assert.deepEqual(reunion.contributions.map(k => [k.id, k.state]), [['ct-omar-01', 'present']]);
  assert.deepEqual(reunion.links.map(l => [l.id, l.state, l.views.length, l.views[0].saved_item_ids]), [['ln-m1', 'active', 1, ['it-m01']]]);
  assert.deepEqual(f.call('fernshelf.albums.get', {id: 'al-garden'}).album.hidden_item_ids, ['it-m09']);
  assert.equal(f.try('fernshelf.albums.get', {id: 'al-none'}).status, 'not_found');
  // notifications.list, by kind and window.
  const n = f.call('fernshelf.notifications.list').notifications;
  assert.deepEqual(n.map(x => [x.id, x.kind, x.email_message_stored]), [['ntf-0001', 'removal.requested', false]]);
  assert.equal(f.call('fernshelf.notifications.list', {kind: 'album.activity'}).notifications.length, 0);
  assert.equal(f.call('fernshelf.notifications.list', {start: '2026-11-17'}).notifications.length, 0);
  assert.equal(f.call('fernshelf.notifications.list', {end: '2026-11-16'}).notifications.length, 1);
  assert.equal(f.try('fernshelf.notifications.list', {start: '2026-11-17', end: '2026-11-16'}).status, 'invalid_window');
  const removals = f.call('fernshelf.removals.list').removals;
  assert.deepEqual(removals.map(r => [r.id, r.state, r.not_removable, r.scope_album_title, r.items.map(i => i.mine)]),
    [['rr-m1', 'pending', ['ct-omar-01'], 'Reunion 2026', [true, false]]]);
  assert.equal(f.call('fernshelf.removals.list', {state: 'honored'}).removals.length, 0);
});

test('T03 storage summary: used, trash, kinds, sources, duplicates, largest; purged and waiting items', () => {
  const f = fixture();
  const s = f.call('fernshelf.storage.summary').storage, data = f.data;
  const counted = data.items.filter(i => i.backed_up && i.id !== 'it-m10');
  assert.equal(s.used_bytes, counted.reduce((n, i) => n + i.declared_bytes, 0));
  assert.equal(s.used_bytes, 851872400);
  assert.equal(s.trash_bytes, 2800000, 'it-m09 only; it-m10 is past its purge_at');
  assert.equal(s.free_bytes, 15e9 - s.used_bytes);
  assert.deepEqual(s.by_kind, {photo: s.used_bytes - 820000000, video: 820000000});
  assert.deepEqual(s.by_source, {camera: s.used_bytes - 1800000, screenshot: 600000, download: 1200000, saved_from_share: 0});
  // Equal content_hash: it-m12 was added after it-m07, so it is the duplicate. st-m1 and st-m2 are not duplicate stacks.
  assert.deepEqual([s.duplicate_bytes, s.duplicate_bytes_from_hashes, s.duplicate_bytes_from_stacks, s.duplicate_item_ids], [300000, 300000, 0, ['it-m12']]);
  assert.deepEqual(s.largest_items.slice(0, 2).map(i => i.id), ['it-m06', 'it-m05']);
  assert.deepEqual([s.pending_bytes, s.pending_items], [0, 0]);
  // A duplicate stack counts its non-cover items; an item that is not backed up counts only as pending.
  const g = fixture({mutate: d => {
    d.stacks.find(x => x.id === 'st-m1').kind = 'duplicate';
    const w = d.items.find(i => i.id === 'it-m08'); w.backed_up = false;
  }});
  const t = g.call('fernshelf.storage.summary').storage;
  assert.equal(t.used_bytes, s.used_bytes - 1200000);
  assert.deepEqual([t.pending_bytes, t.pending_items], [1200000, 1]);
  assert.equal(t.by_source.download, 0);
  assert.deepEqual([t.duplicate_bytes_from_stacks, t.duplicate_bytes, t.duplicate_item_ids], [4790100, 5090100, ['it-m02', 'it-m12']]);
  // Purged items count nowhere: after the clock passes it-m09's purge_at, used and trash drop by its bytes.
  g.advance('2026-12-11T00:00:00-08:00');
  const u = g.call('fernshelf.storage.summary').storage;
  assert.deepEqual([u.used_bytes, u.trash_bytes], [t.used_bytes - 2800000, 0]);
});

test('T04 items.read without image files: no_file, gone, not_found, not_yours', () => {
  const f = fixture({mutate: d => { d.items.find(i => i.id === 'it-m08').backed_up = false; }});
  assert.equal(f.try('fernshelf.items.read', {id: 'it-m03'}).status, 'no_file');
  assert.match(f.try('fernshelf.items.read', {id: 'it-m08'}).message, /not backed up/);
  assert.equal(f.try('fernshelf.items.read', {id: 'it-m06'}).status, 'no_file');
  assert.equal(f.try('fernshelf.items.read', {id: 'it-m10'}).status, 'gone');
  assert.equal(f.try('fernshelf.items.read', {id: 'it-x'}).status, 'not_found');
  assert.equal(f.try('fernshelf.items.read', {id: 'ct-omar-01'}).status, 'not_yours');
});

test('T05 exposure and the visibility function: members by status, links by state, trash, views and saves', () => {
  const f = fixture();
  const e = f.call('fernshelf.exposure.get', {id: 'it-m01'});
  assert.equal(e.visible, true);
  assert.deepEqual(e.visible_to, ['person-kofi', 'person-omar']);
  assert.deepEqual(e.albums.map(a => [a.album_id, a.members.map(m => m.person_id + ':' + m.status), a.links.map(l => l.link_id)]),
    [['al-reunion', ['person-kofi:joined', 'person-omar:joined'], ['ln-m1']]], 'a declined member is not listed');
  assert.deepEqual(e.views.map(v => [v.view_id, v.viewer.person_id, v.at]), [['vw-m1', 'person-kofi', '2026-11-15T20:14:00-08:00']]);
  assert.deepEqual(e.saves.map(v => v.view_id), ['vw-m1']);
  assert.deepEqual(e.removal_requests.map(r => r.id), ['rr-m1']);
  assert.deepEqual(f.call('fernshelf.exposure.get', {id: 'it-m03'}).saves, []);
  // A private album exposes nothing; a member's contribution is exposed through its album.
  assert.deepEqual([f.call('fernshelf.exposure.get', {id: 'it-m05'}).visible, f.call('fernshelf.exposure.get', {id: 'it-m05'}).albums], [false, []]);
  const k = f.call('fernshelf.exposure.get', {id: 'ct-omar-01'});
  assert.deepEqual([k.mine, k.state, k.albums.map(a => a.album_id)], [false, 'active', ['al-reunion']]);
  assert.equal(f.try('fernshelf.exposure.get', {id: 'it-nope'}).status, 'not_found');
  // Invited members are listed but cannot see it yet; removed members are not listed; a revoked link and an expired link show nothing.
  const g = fixture({mutate: d => {
    const al = d.albums.find(a => a.id === 'al-reunion');
    al.members.push({person_id: 'person-dana', role: 'viewer', status: 'invited', invited_at: '2026-11-18T09:00:00-08:00', joined_at: null, ended_at: null, history: []});
    Object.assign(al.members.find(m => m.person_id === 'person-kofi'), {status: 'removed', ended_at: '2026-11-19T09:00:00-08:00'});
    d.links.push({id: 'ln-old', album_id: 'al-reunion', created_at: '2026-11-15T12:00:00-08:00', expires_at: null, revoked_at: '2026-11-16T12:00:00-08:00', revoke_reason: 'revoked', request_id: null});
  }});
  const e2 = g.call('fernshelf.exposure.get', {id: 'it-m01'});
  assert.deepEqual(e2.albums[0].members.map(m => m.person_id + ':' + m.status), ['person-omar:joined', 'person-dana:invited']);
  assert.deepEqual(e2.visible_to, ['person-omar']);
  assert.deepEqual(e2.albums[0].links.map(l => l.link_id), ['ln-m1'], 'the revoked link is not listed');
  assert.equal(e2.views.length, 1, 'a view recorded through a link is always listed');
  g.advance('2027-01-01T00:00:00-08:00');
  const e3 = g.call('fernshelf.exposure.get', {id: 'it-m01'});
  assert.deepEqual([e3.albums[0].links, e3.visible_to, e3.views.length, e3.saves.length], [[], ['person-omar'], 1, 1]);
  // A trashed item is visible nowhere and lists the shared albums it would return to.
  const h = fixture({mutate: d => { Object.assign(d.items.find(i => i.id === 'it-m01'), {state: 'trashed', trashed_at: '2026-11-19T10:00:00-08:00', purge_at: '2026-12-19T10:00:00-08:00'});
    const s = d.stacks.find(x => x.id === 'st-m1'); s.cover_id = 'it-m02'; }});
  const t = h.call('fernshelf.exposure.get', {id: 'it-m01'});
  assert.deepEqual([t.state, t.visible, t.albums, t.returns_on_restore.map(a => a.album_id), t.views.length, t.saves.length], ['trashed', false, [], ['al-reunion'], 1, 1]);
  // The pure visibility function agrees with exposure.get.
  const rows = plugin.visibility(f.data, f.now);
  assert.deepEqual(rows.map(r => [r.item_id, r.mine, r.people, r.links.map(l => l.link_id)]),
    [['it-m01', true, ['person-kofi', 'person-omar'], ['ln-m1']], ['it-m03', true, ['person-kofi', 'person-omar'], ['ln-m1']], ['ct-omar-01', false, ['person-kofi', 'person-omar'], ['ln-m1']]]);
  assert.deepEqual(plugin.visibility(h.data, h.now).map(r => r.item_id), ['it-m03', 'ct-omar-01']);
  assert.deepEqual(plugin.visibility(g.data, '2027-01-01T00:00:00-08:00').map(r => [r.item_id, r.links.length]), [['it-m01', 0], ['it-m03', 0], ['ct-omar-01', 0]]);
});
