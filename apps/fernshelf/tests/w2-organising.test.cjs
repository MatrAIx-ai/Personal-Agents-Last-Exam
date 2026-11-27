'use strict';
// W2 Organising: T06 (items.update, covers) and T07 (albums).
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');

const item = (f, id) => f.data.items.find(i => i.id === id);
const stack = (f, id) => f.data.stacks.find(s => s.id === id);
const album = (f, id) => f.data.albums.find(a => a.id === id);
function refused(f, name, args, code) {
  const before = f.revision, r = f.try(name, args);
  assert.equal(r.status, code, name + ' ' + JSON.stringify(args) + ' -> ' + r.message);
  assert.equal(f.revision, before, 'version unchanged after ' + code);
  return r;
}

test('T06 items.update: every field, history rows, labels, make_cover and its refusals', () => {
  const f = fixture();
  const rows = f.data.activity.length;
  const r = f.call('fernshelf.items.update', {id: 'it-m03', patch: {caption: 'Kofi and the lemon cake', favorite: true, archived: true,
    taken_at: '2026-11-14T17:21:30-08:00', add_people: ['pl-omar', 'pl-maya'], remove_people: ['pl-kofi']}});
  assert.deepEqual([r.id, r.state, r.changed.sort(), r.stack_id], ['it-m03', 'active', ['add_people', 'archived', 'caption', 'favorite', 'remove_people', 'taken_at'], null]);
  const it = item(f, 'it-m03');
  assert.deepEqual([it.caption, it.favorite, it.archived, it.taken_at, it.people], ['Kofi and the lemon cake', true, true, '2026-11-14T17:21:30-08:00', ['pl-omar', 'pl-maya']]);
  const h = it.history.at(-1);
  assert.deepEqual([h.action, h.actor, h.at, h.changes.caption, h.changes.people], ['updated', 'agent', f.now,
    {from: 'Kofi and the cake', to: 'Kofi and the lemon cake'}, {from: ['pl-kofi'], to: ['pl-omar', 'pl-maya']}]);
  assert.equal(f.data.activity.length, rows + 1);
  assert.deepEqual(f.data.activity.at(-1).object_ids, ['it-m03']);
  // A search by the new label finds it; the removed label no longer does; caption null clears.
  assert.ok(f.call('fernshelf.items.search', {label_id: 'pl-omar', archived: true}).rows.some(x => x.id === 'it-m03'));
  assert.ok(!f.call('fernshelf.items.search', {label_id: 'pl-kofi'}).rows.some(x => x.id === 'it-m03'));
  f.call('fernshelf.items.update', {id: 'it-m03', patch: {caption: null}});
  assert.equal(item(f, 'it-m03').caption, null);
  // make_cover: the original of the edit stack becomes the search row.
  assert.equal(f.call('fernshelf.items.update', {id: 'it-m04', patch: {make_cover: true}}).cover_id, 'it-m04');
  assert.equal(stack(f, 'st-m2').cover_id, 'it-m04');
  const row = f.call('fernshelf.items.search', {label_id: 'pl-ruth', place: 'garden'}).rows;
  assert.deepEqual(row.map(x => [x.id, x.is_cover, x.stack_size]), [['it-m04', true, 2]]);
  // Refusals, each leaving the version unchanged.
  refused(f, 'fernshelf.items.update', {id: 'it-m09', patch: {favorite: true}}, 'in_trash');
  refused(f, 'fernshelf.items.update', {id: 'it-m10', patch: {favorite: true}}, 'gone');
  refused(f, 'fernshelf.items.update', {id: 'ct-omar-01', patch: {caption: 'mine now'}}, 'not_yours');
  refused(f, 'fernshelf.items.update', {id: 'it-nope', patch: {favorite: true}}, 'not_found');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {make_cover: true}}, 'not_stacked');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {add_people: ['pl-stranger']}}, 'not_found');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {}}, 'invalid_arguments');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {add_people: ['pl-omar']}}, 'invalid_arguments');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {remove_people: ['pl-ruth']}}, 'invalid_arguments');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {add_people: ['pl-ruth'], remove_people: ['pl-ruth']}}, 'invalid_arguments');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {taken_at: '2026-11-15T09:00:00-08:00'}}, 'invalid_arguments');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {taken_at: '2026-11-14 17:00'}}, 'invalid_arguments');
  refused(f, 'fernshelf.items.update', {id: 'it-m03', patch: {make_cover: false}}, 'invalid_arguments');
});

test('T06 cover promotion when the cover is trashed and when a version is restored', () => {
  // st-m1 with three versions: it-m01 (16:41:10, cover), it-m02 (16:41:12), it-m03 (17:20).
  const f = fixture({mutate: d => { d.stacks.find(s => s.id === 'st-m1').item_ids.push('it-m03'); }});
  assert.deepEqual(f.call('fernshelf.items.trash', {ids: ['it-m02']}).covers_changed, [], 'a non-cover leaves the cover alone');
  f.call('fernshelf.items.restore', {ids: ['it-m02']});
  const t1 = f.call('fernshelf.items.trash', {ids: ['it-m01']});
  assert.deepEqual(t1.covers_changed, [{stack_id: 'st-m1', cover_id: 'it-m03'}], 'the newest remaining version');
  f.call('fernshelf.items.trash', {ids: ['it-m03']});
  assert.equal(stack(f, 'st-m1').cover_id, 'it-m02');
  f.call('fernshelf.items.trash', {ids: ['it-m02']});
  assert.equal(stack(f, 'st-m1').cover_id, null, 'the stack is empty until a version is restored');
  assert.deepEqual(f.call('fernshelf.items.search', {label_id: 'pl-dana', collapse_stacks: false}).rows, []);
  f.call('fernshelf.items.restore', {ids: ['it-m01', 'it-m02']});
  assert.equal(stack(f, 'st-m1').cover_id, 'it-m02', 'an empty stack takes the newest restored version');
  f.call('fernshelf.items.restore', {ids: ['it-m03']});
  assert.equal(stack(f, 'st-m1').cover_id, 'it-m02', 'an existing cover stays');
  refused(f, 'fernshelf.items.update', {id: 'it-m09', patch: {make_cover: true}}, 'in_trash');
  f.call('fernshelf.items.update', {id: 'it-m03', patch: {make_cover: true}});
  const versions = f.call('fernshelf.items.get', {id: 'it-m01'}).item.stack.versions;
  assert.deepEqual(versions.map(v => [v.id, v.is_cover]), [['it-m01', false], ['it-m02', false], ['it-m03', true]]);
});

test('T07 albums: create, rename, add, remove and reorder in one update, delete; refusals and all-or-nothing', () => {
  const f = fixture();
  const a = f.call('fernshelf.albums.create', {title: '  Autumn  '});
  assert.deepEqual([a.id, a.title, a.state], ['al-n0001', 'Autumn', 'private']);
  assert.equal(f.call('fernshelf.albums.create', {title: 'Second'}).id, 'al-n0002');
  const u1 = f.call('fernshelf.albums.update', {id: a.id, add_ids: ['it-m03', 'it-m05', 'it-m06', 'it-m07', 'it-m08', 'it-m13']});
  assert.deepEqual(u1.item_ids, ['it-m03', 'it-m05', 'it-m06', 'it-m07', 'it-m08', 'it-m13']);
  assert.deepEqual(u1.warnings, []);
  const u2 = f.call('fernshelf.albums.update', {id: a.id, title: 'Autumn 2026', remove_ids: ['it-m06'], add_ids: ['it-m12'], order: ['it-m13', 'it-m12']});
  assert.deepEqual([u2.title, u2.item_ids, u2.added, u2.removed], ['Autumn 2026', ['it-m13', 'it-m12', 'it-m03', 'it-m05', 'it-m07', 'it-m08'], ['it-m12'], ['it-m06']]);
  assert.deepEqual(f.call('fernshelf.albums.get', {id: a.id}).album.entries.map(e => e.id), u2.item_ids);
  const act = f.data.activity.at(-1);
  assert.deepEqual([act.action, act.object_ids, act.details.order], ['albums.update', [a.id, 'it-m06', 'it-m12'], ['it-m13', 'it-m12']]);
  // Refusals; the album and version are unchanged after each.
  const before = JSON.stringify(album(f, a.id));
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: ['it-m09']}, 'in_trash');
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: ['it-m10']}, 'gone');
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: ['it-m13']}, 'already_in_album');
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: ['ct-omar-01']}, 'not_yours');
  refused(f, 'fernshelf.albums.update', {id: a.id, remove_ids: ['it-m01']}, 'not_in_album');
  refused(f, 'fernshelf.albums.update', {id: a.id, remove_ids: ['it-zz']}, 'not_found');
  refused(f, 'fernshelf.albums.update', {id: a.id, order: ['it-m01']}, 'not_in_album');
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: Array.from({length: 51}, (_, k) => 'it-x' + k)}, 'limit_exceeded');
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: Array.from({length: 26}, (_, k) => 'it-x' + k), remove_ids: Array.from({length: 25}, (_, k) => 'it-y' + k)}, 'limit_exceeded');
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: ['it-m01'], remove_ids: ['it-m01']}, 'invalid_arguments');
  refused(f, 'fernshelf.albums.update', {id: a.id}, 'invalid_arguments');
  refused(f, 'fernshelf.albums.update', {id: a.id, title: '   '}, 'invalid_arguments');
  refused(f, 'fernshelf.albums.update', {id: 'al-none', title: 'x'}, 'not_found');
  // All or nothing: one bad item in the batch, nothing added, the title not changed either.
  refused(f, 'fernshelf.albums.update', {id: a.id, title: 'Changed', add_ids: ['it-m01', 'it-m02', 'it-m09']}, 'in_trash');
  assert.equal(JSON.stringify(album(f, a.id)), before);
  // A member's contribution cannot be removed by the Agent.
  refused(f, 'fernshelf.albums.update', {id: 'al-reunion', remove_ids: ['ct-omar-01']}, 'not_yours');
  // Deleting: a shared album needs confirm; a private one does not.
  refused(f, 'fernshelf.albums.delete', {id: 'al-reunion'}, 'confirm_required');
  refused(f, 'fernshelf.albums.delete', {id: 'al-reunion', confirm: false}, 'confirm_required');
  assert.equal(f.call('fernshelf.albums.delete', {id: a.id}).state, 'deleted');
  const del = f.call('fernshelf.albums.delete', {id: 'al-reunion', confirm: true});
  assert.deepEqual([del.state, del.revoked_link_ids], ['deleted', ['ln-m1']]);
  const link = f.data.links.find(l => l.id === 'ln-m1');
  assert.deepEqual([link.revoked_at, link.revoke_reason], [f.now, 'album_deleted']);
  assert.ok(f.call('fernshelf.items.search', {}).rows.some(x => x.id === 'it-m01'), 'its items stay in the library');
  assert.equal(f.call('fernshelf.exposure.get', {id: 'it-m01'}).visible, false);
  assert.deepEqual(f.call('fernshelf.albums.list').albums.map(x => x.id), ['al-garden', 'al-n0002']);
  assert.deepEqual(f.call('fernshelf.albums.list', {include_deleted: true}).albums.map(x => [x.id, x.state]),
    [['al-reunion', 'deleted'], ['al-garden', 'private'], ['al-n0001', 'deleted'], ['al-n0002', 'private']]);
  assert.equal(f.call('fernshelf.albums.get', {id: 'al-reunion'}).album.state, 'deleted');
  refused(f, 'fernshelf.albums.update', {id: 'al-reunion', title: 'Back'}, 'not_found');
  refused(f, 'fernshelf.albums.delete', {id: 'al-reunion', confirm: true}, 'not_found');
  // Not backed up items cannot be put in an album.
  const g = fixture({mutate: d => { d.items.find(i => i.id === 'it-m08').backed_up = false; }});
  refused(g, 'fernshelf.albums.update', {id: 'al-garden', add_ids: ['it-m08']}, 'not_backed_up');
});
