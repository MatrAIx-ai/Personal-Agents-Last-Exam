'use strict';
// W3 Sharing: T08 (members and events that name albums by match), T09 (contributions and saving),
// T10 (links, views and saves).
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');

const album = (f, id) => f.data.albums.find(a => a.id === id);
const member = (f, albumId, p) => album(f, albumId).members.find(m => m.person_id === p);
function refused(f, name, args, code) {
  const before = f.revision, r = f.try(name, args);
  assert.equal(r.status, code, name + ' ' + JSON.stringify(args) + ' -> ' + r.message);
  assert.equal(f.revision, before, 'version unchanged after ' + code);
  return r;
}
function rejected(f, e, pattern) {
  const before = f.revision, now = f.now, r = f.tryEvent(e);
  assert.equal(r.status, 'invalid_event', JSON.stringify(e.payload) + ' -> ' + r.message);
  if (pattern) assert.match(r.message, pattern);
  assert.equal(f.revision, before);
  assert.equal(f.now, now, 'a rejected event leaves the clock where it was');
  return r;
}
const joinEv = (at, payload, id) => ev('member.changed', at, payload, id);

test('T08 members: invite, join, decline, leave, role change, removal; shared and private again; refusals', () => {
  const f = fixture();
  const inv = f.call('fernshelf.albums.members.invite', {id: 'al-garden', person_id: 'person-dana', role: 'viewer'});
  assert.deepEqual([inv.member_status, inv.state, inv.warnings], ['invited', 'shared', []]);
  assert.equal(f.call('fernshelf.albums.get', {id: 'al-garden'}).album.state, 'shared');
  // Invited is not yet visible; joined is.
  assert.deepEqual(f.call('fernshelf.exposure.get', {id: 'it-m05'}).visible_to, []);
  f.event(joinEv('2026-11-20T10:00:00-08:00', {album_id: 'al-garden', person_id: 'person-dana', change: 'join'}));
  assert.deepEqual([member(f, 'al-garden', 'person-dana').status, member(f, 'al-garden', 'person-dana').joined_at], ['joined', '2026-11-20T10:00:00-08:00']);
  for (const id of ['it-m05']) assert.deepEqual(f.call('fernshelf.exposure.get', {id}).visible_to, ['person-dana']);
  const n = f.data.notifications.at(-1);
  assert.deepEqual([n.kind, n.object_id, n.title], ['album.activity', 'al-garden', 'Dana Ilvesmaa joined Garden']);
  // Decline and the album stays shared while someone is joined.
  f.call('fernshelf.albums.members.invite', {id: 'al-garden', person_id: 'person-lena', role: 'contributor'});
  f.event(joinEv('2026-11-20T10:05:00-08:00', {album_id: 'al-garden', person_id: 'person-lena', change: 'decline'}));
  assert.deepEqual([member(f, 'al-garden', 'person-lena').status, album(f, 'al-garden') && f.call('fernshelf.albums.get', {id: 'al-garden'}).album.state], ['declined', 'shared']);
  assert.match(f.data.notifications.at(-1).title, /Lena Corvi declined your invitation to Garden/);
  // Role change, then refusals.
  const role = f.call('fernshelf.albums.members.update', {id: 'al-garden', person_id: 'person-dana', role: 'contributor'});
  assert.deepEqual([role.role, role.member_status], ['contributor', 'joined']);
  refused(f, 'fernshelf.albums.members.invite', {id: 'al-garden', person_id: 'person-dana', role: 'viewer'}, 'already_invited');
  refused(f, 'fernshelf.albums.members.invite', {id: 'al-garden', person_id: 'person-maya', role: 'viewer'}, 'invalid_arguments');
  refused(f, 'fernshelf.albums.members.invite', {id: 'al-garden', person_id: 'person-nobody', role: 'viewer'}, 'not_found');
  refused(f, 'fernshelf.albums.members.update', {id: 'al-garden', person_id: 'person-omar', role: 'viewer'}, 'not_member');
  refused(f, 'fernshelf.albums.members.update', {id: 'al-garden', person_id: 'person-lena', role: 'viewer'}, 'invalid_state');
  refused(f, 'fernshelf.albums.members.update', {id: 'al-garden', person_id: 'person-dana'}, 'invalid_arguments');
  refused(f, 'fernshelf.albums.members.update', {id: 'al-garden', person_id: 'person-dana', role: 'viewer', remove: true}, 'invalid_arguments');
  // Re-inviting someone who declined is allowed.
  assert.equal(f.call('fernshelf.albums.members.invite', {id: 'al-garden', person_id: 'person-lena', role: 'viewer'}).member_status, 'invited');
  assert.deepEqual([member(f, 'al-garden', 'person-lena').joined_at, member(f, 'al-garden', 'person-lena').ended_at], [null, null]);
  // Remove the invitee, then Dana leaves: the album is private again.
  const rem = f.call('fernshelf.albums.members.update', {id: 'al-garden', person_id: 'person-lena', remove: true});
  assert.deepEqual([rem.member_status, rem.state], ['removed', 'shared']);
  f.event(joinEv('2026-11-20T11:00:00-08:00', {album_id: 'al-garden', person_id: 'person-dana', change: 'leave'}));
  assert.equal(f.call('fernshelf.albums.get', {id: 'al-garden'}).album.state, 'private');
  assert.deepEqual(f.call('fernshelf.exposure.get', {id: 'it-m05'}).albums, []);
  // A leaving member's contributions leave the album.
  f.event(joinEv('2026-11-20T11:30:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar', change: 'leave'}));
  const reunion = f.call('fernshelf.albums.get', {id: 'al-reunion'}).album;
  assert.deepEqual([reunion.entries.map(e => e.id), reunion.contributions[0].state, reunion.contributions[0].removed_reason], [['it-m01', 'it-m03'], 'removed', 'member_left']);
  assert.equal(f.call('fernshelf.exposure.get', {id: 'ct-omar-01'}).state, 'removed');
  assert.match(f.data.notifications.at(-1).body, /The 1 item they added left the album with them/);
  const rows = f.data.activity.filter(a => a.event_id === f.data.activity.at(-1).event_id).map(a => a.action);
  assert.deepEqual(rows, ['event.member.changed', 'effect.member.left', 'effect.contributions.removed', 'effect.notification.written']);
  // Removing a member drops their contributions too.
  const g = fixture();
  const r2 = g.call('fernshelf.albums.members.update', {id: 'al-reunion', person_id: 'person-omar', remove: true});
  assert.deepEqual(r2.contributions_removed, ['ct-omar-01']);
  assert.equal(g.data.albums[0].contributions[0].removed_reason, 'member_removed');
  // Invalid member events.
  rejected(g, joinEv('2026-11-20T12:00:00-08:00', {album_id: 'al-garden', person_id: 'person-dana', change: 'join'}), /not invited/);
  rejected(g, joinEv('2026-11-20T12:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-kofi', change: 'join'}), /not invited/);
  rejected(g, joinEv('2026-11-20T12:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-ruth', change: 'leave'}));
  rejected(g, joinEv('2026-11-20T12:00:00-08:00', {album_id: 'al-nowhere', person_id: 'person-kofi', change: 'leave'}), /Unknown album/);
});

test('T08 events that name an album created in the run by album_match: by items, person, title; newest wins; no match; replay keeps the first resolution', () => {
  const f = fixture();
  const a = f.call('fernshelf.albums.create', {title: 'Reunion picks'});
  f.call('fernshelf.albums.update', {id: a.id, add_ids: ['it-m03']});
  // No invitation yet: the match (which includes "Dana invited there") finds nothing.
  rejected(f, joinEv('2026-11-20T09:30:00-08:00', {album_match: {contains_item_ids: ['it-m03']}, person_id: 'person-dana', change: 'join'}), /found no album/);
  f.call('fernshelf.albums.members.invite', {id: a.id, person_id: 'person-dana', role: 'viewer'});
  f.call('fernshelf.links.create', {id: a.id});
  // By items held.
  f.event(joinEv('2026-11-20T09:40:00-08:00', {album_match: {contains_item_ids: ['it-m03']}, person_id: 'person-dana', change: 'join'}, 'ev-fs-412'));
  assert.equal(member(f, a.id, 'person-dana').status, 'joined');
  const row = f.data.activity.find(x => x.event_id === 'ev-fs-412');
  assert.deepEqual([row.action, row.object_ids[0], row.details.album_id, row.details.resolved_by_match], ['event.member.changed', a.id, a.id, true]);
  // By person (the empty match means "the album this person was invited to") and by title, case-folded and trimmed.
  const b = f.call('fernshelf.albums.create', {title: 'Cabin Weekend'});
  f.call('fernshelf.albums.members.invite', {id: b.id, person_id: 'person-kofi', role: 'contributor'});
  f.event(joinEv('2026-11-20T09:50:00-08:00', {album_match: {}, person_id: 'person-kofi', change: 'join'}));
  assert.equal(member(f, b.id, 'person-kofi').status, 'joined');
  f.call('fernshelf.albums.members.invite', {id: b.id, person_id: 'person-lena', role: 'viewer'});
  f.call('fernshelf.albums.members.invite', {id: 'al-garden', person_id: 'person-lena', role: 'viewer'});
  f.event(joinEv('2026-11-20T09:55:00-08:00', {album_match: {title: '  cabin WEEKEND '}, person_id: 'person-lena', change: 'decline'}));
  assert.deepEqual([member(f, b.id, 'person-lena').status, member(f, 'al-garden', 'person-lena').status], ['declined', 'invited']);
  // Several matches: the most recently created album is taken.
  const c1 = f.call('fernshelf.albums.create', {title: 'Older'}), c2 = f.call('fernshelf.albums.create', {title: 'Newer'});
  for (const x of [c1, c2]) f.call('fernshelf.albums.members.invite', {id: x.id, person_id: 'person-ruth', role: 'viewer'});
  f.event(joinEv('2026-11-20T10:00:00-08:00', {album_match: {person_id: 'person-ruth'}, person_id: 'person-ruth', change: 'join'}, 'ev-fs-420'));
  assert.deepEqual([member(f, c2.id, 'person-ruth').status, member(f, c1.id, 'person-ruth').status], ['joined', 'invited']);
  // A leave by match needs the person joined: Ruth is joined only in c2.
  // Replay: the same event_id and content returns the stored receipt and resolves nothing again.
  const before = f.data, rows = f.data.activity.length;
  const c3 = f.call('fernshelf.albums.create', {title: 'Newest'});
  f.call('fernshelf.albums.members.invite', {id: c3.id, person_id: 'person-ruth', role: 'viewer'});
  const replay = f.event(joinEv('2026-11-20T10:00:00-08:00', {album_match: {person_id: 'person-ruth'}, person_id: 'person-ruth', change: 'join'}, 'ev-fs-420'));
  assert.equal(replay.duplicate, true);
  assert.equal(member(f, c3.id, 'person-ruth').status, 'invited', 'the replay did not join the newer album');
  assert.deepEqual(f.data.activity.filter(x => x.event_id === 'ev-fs-420').map(x => x.action), ['event.member.changed', 'effect.member.joined', 'effect.notification.written'],
    'still only the first application\'s rows');
  assert.equal(f.data.activity.find(x => x.event_id === 'ev-fs-420').details.album_id, c2.id);
  assert.equal(f.data.activity.length, rows + 2, 'only the two Agent writes added rows');
  assert.equal(before.albums.length + 1, f.data.albums.length);
  const changed = f.tryEvent(joinEv('2026-11-20T10:00:00-08:00', {album_match: {person_id: 'person-ruth'}, person_id: 'person-ruth', change: 'decline'}, 'ev-fs-420'));
  assert.equal(changed.status, 'idempotency_conflict');
  // A match that only deleted albums satisfy finds nothing.
  f.call('fernshelf.albums.delete', {id: c3.id, confirm: true});
  rejected(f, joinEv('2026-11-20T10:10:00-08:00', {album_match: {title: 'Newest'}, person_id: 'person-ruth', change: 'join'}), /found no album/);
});

test('T09 contributions and saving: not mine, no storage, save_item, not_shared, over_quota, viewer contribution rejected', () => {
  const f = fixture();
  const used0 = f.call('fernshelf.storage.summary').storage.used_bytes;
  f.event(ev('contribution.changed', '2026-11-20T10:30:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar',
    add: [{item_id: 'ct-omar-0007', kind: 'photo', taken_at: '2026-11-14T17:05:00-08:00', people: ['pl-dana'], declared_bytes: 3920000}], remove: []}));
  const got = f.call('fernshelf.albums.get', {id: 'al-reunion'}).album;
  assert.deepEqual(got.entries.map(e => e.id), ['it-m01', 'it-m03', 'ct-omar-01', 'ct-omar-0007']);
  assert.equal(f.data.notifications.at(-1).title, 'Omar Sandquist added 1 photo in Reunion 2026');
  assert.equal(f.call('fernshelf.storage.summary').storage.used_bytes, used0, 'contributions use no storage');
  refused(f, 'fernshelf.items.get', {id: 'ct-omar-0007'}, 'not_yours');
  refused(f, 'fernshelf.items.trash', {ids: ['ct-omar-0007']}, 'not_yours');
  refused(f, 'fernshelf.items.update', {id: 'ct-omar-0007', patch: {favorite: true}}, 'not_yours');
  // Save it: a new item of mine with source saved_from_share, counted in storage.
  const s = f.call('fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'ct-omar-0007'});
  assert.deepEqual([s.id, s.source, s.state, s.used_bytes], ['it-s0001', 'saved_from_share', 'active', used0 + 3920000]);
  const mineNow = f.call('fernshelf.items.get', {id: 'it-s0001'}).item;
  assert.deepEqual([mineNow.saved_from, mineNow.backed_up, mineNow.people, mineNow.file], [{album_id: 'al-reunion', contribution_id: 'ct-omar-0007', person_id: 'person-omar'}, true, ['pl-dana'], null]);
  assert.equal(f.call('fernshelf.storage.summary').storage.by_source.saved_from_share, 3920000);
  refused(f, 'fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'ct-omar-0007'}, 'invalid_state');
  refused(f, 'fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'it-m01'}, 'not_shared');
  refused(f, 'fernshelf.albums.save_item', {id: 'al-garden', item_id: 'ct-omar-01'}, 'not_shared');
  refused(f, 'fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'ct-nope'}, 'not_found');
  // The saved copy follows every rule of my items; the contributor withdrawing the original does not touch it.
  f.call('fernshelf.albums.update', {id: 'al-garden', add_ids: ['it-s0001']});
  f.event(ev('contribution.changed', '2026-11-20T11:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar', remove: ['ct-omar-0007']}));
  assert.equal(f.data.notifications.at(-1).title, 'Omar Sandquist removed 1 item in Reunion 2026');
  assert.equal(f.call('fernshelf.items.get', {id: 'it-s0001'}).item.state, 'active');
  refused(f, 'fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'ct-omar-0007'}, 'not_shared');
  // over_quota.
  const g = fixture({mutate: d => { d.account.quota_bytes = 851872400 + 3920000 - 1; }});
  refused(g, 'fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'ct-omar-01'}, 'over_quota');
  const h = fixture({mutate: d => { d.account.quota_bytes = 851872400 + 3920000; }});
  assert.equal(h.call('fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'ct-omar-01'}).used_bytes, h.data.account.quota_bytes, 'exactly at the quota fits');
  // A viewer's contribution, someone else's removal and an empty change are rejected as events.
  rejected(f, ev('contribution.changed', '2026-11-20T12:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-kofi',
    add: [{item_id: 'ct-kofi-1', kind: 'photo', taken_at: '2026-11-14T17:00:00-08:00', declared_bytes: 1000}]}), /not a joined contributor/);
  rejected(f, ev('contribution.changed', '2026-11-20T12:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar', remove: ['it-m01']}));
  rejected(f, ev('contribution.changed', '2026-11-20T12:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar', add: [], remove: []}));
  rejected(f, ev('contribution.changed', '2026-11-20T12:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar',
    add: [{item_id: 'it-m03', kind: 'photo', taken_at: '2026-11-14T17:00:00-08:00', declared_bytes: 1000}]}), /Duplicate item/);
  rejected(f, ev('contribution.changed', '2026-11-20T12:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar',
    add: [{item_id: 'ct-new', kind: 'photo', taken_at: '2026-11-14T17:00:00-08:00', declared_bytes: 1000, people: ['pl-ghost']}]}), /Unknown people label/);
  rejected(f, ev('contribution.changed', '2026-11-20T12:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar',
    add: [{item_id: 'ct-new', kind: 'photo', taken_at: '2026-11-21T17:00:00-08:00', declared_bytes: 1000}]}));
});

test('T10 links: expiry, views and saves named and anonymous, revoke, expiry by the clock, a link follows its album', () => {
  const f = fixture();
  refused(f, 'fernshelf.links.create', {id: 'al-garden', expires_at: '2026-11-20T08:00:00-08:00'}, 'invalid_window');
  refused(f, 'fernshelf.links.create', {id: 'al-garden', expires_at: f.now}, 'invalid_window');
  refused(f, 'fernshelf.links.create', {id: 'al-none'}, 'not_found');
  const open = f.call('fernshelf.links.create', {id: 'al-garden'});
  const week = f.call('fernshelf.links.create', {id: 'al-garden', expires_at: '2026-11-27T09:00:00-08:00'});
  assert.deepEqual([open.id, open.state, open.expires_at, week.id, week.expires_at], ['ln-n0001', 'active', null, 'ln-n0002', '2026-11-27T09:00:00-08:00']);
  assert.equal(f.call('fernshelf.albums.get', {id: 'al-garden'}).album.state, 'private', 'a link does not make the album shared');
  assert.deepEqual(f.call('fernshelf.exposure.get', {id: 'it-m05'}).albums[0].links.map(l => l.link_id), ['ln-n0001', 'ln-n0002']);
  // A link follows its album: an added item is shown, a removed or trashed one is not.
  f.call('fernshelf.albums.update', {id: 'al-garden', add_ids: ['it-m04', 'it-m13']});
  f.event(ev('share.viewed', '2026-11-20T10:00:00-08:00', {view_id: 'vw-a', surface: {type: 'link', id: 'ln-n0002'}, viewer: {anonymous: true}, viewed_item_ids: 'all', saved_item_ids: ['it-m04']}));
  f.call('fernshelf.albums.update', {id: 'al-garden', remove_ids: ['it-m13']});
  f.call('fernshelf.items.trash', {ids: ['it-m04']});
  f.event(ev('share.viewed', '2026-11-20T10:30:00-08:00', {view_id: 'vw-b', surface: {type: 'link', album_id: 'al-garden'}, viewer: {person_id: 'person-lena'}, viewed_item_ids: 'all', saved_item_ids: 'all'}));
  const views = f.data.views.slice(-2);
  assert.deepEqual(views.map(v => [v.id, v.surface.link_id, v.viewer.anonymous, v.viewed_item_ids, v.saved_item_ids]),
    [['vw-a', 'ln-n0002', true, ['it-m05', 'it-m04', 'it-m13'], ['it-m04']], ['vw-b', 'ln-n0002', false, ['it-m05'], ['it-m05']]],
    'a link named through its album resolves to its newest active link');
  assert.equal(f.data.notifications.length, 1, 'views write no notification');
  // An item the link does not show now is rejected.
  rejected(f, ev('share.viewed', '2026-11-20T10:40:00-08:00', {view_id: 'vw-c', surface: {type: 'link', id: 'ln-n0001'}, viewer: {anonymous: true}, viewed_item_ids: ['it-m13']}), /not shown/);
  rejected(f, ev('share.viewed', '2026-11-20T10:40:00-08:00', {view_id: 'vw-c', surface: {type: 'link', id: 'ln-n0001'}, viewer: {anonymous: true}, viewed_item_ids: ['it-m04']}), /not shown/);
  rejected(f, ev('share.viewed', '2026-11-20T10:40:00-08:00', {view_id: 'vw-c', surface: {type: 'link', id: 'ln-n0001'}, viewer: {anonymous: true}, viewed_item_ids: [], saved_item_ids: 'all'}), /not viewed/);
  rejected(f, ev('share.viewed', '2026-11-20T10:40:00-08:00', {view_id: 'vw-a', surface: {type: 'link', id: 'ln-n0001'}, viewer: {anonymous: true}, viewed_item_ids: 'all'}), /Duplicate view/);
  rejected(f, ev('share.viewed', '2026-11-20T10:40:00-08:00', {view_id: 'vw-c', surface: {type: 'link', id: 'ln-zz'}, viewer: {anonymous: true}, viewed_item_ids: 'all'}), /Unknown link/);
  rejected(f, ev('share.viewed', '2026-11-20T10:40:00-08:00', {view_id: 'vw-c', surface: {type: 'link', id: 'ln-n0001'}, viewer: {person_id: 'person-ghost'}, viewed_item_ids: 'all'}), /Unknown viewer/);
  rejected(f, ev('share.viewed', '2026-11-20T10:40:00-08:00', {view_id: 'vw-c', surface: {type: 'link', id: 'ln-n0001'}, viewer: {person_id: 'person-maya'}, viewed_item_ids: 'all'}));
  // Album surfaces are viewed by joined members only.
  f.event(ev('share.viewed', '2026-11-20T10:45:00-08:00', {view_id: 'vw-d', surface: {type: 'album', album_match: {title: 'reunion 2026'}}, viewer: {person_id: 'person-omar'}, viewed_item_ids: ['ct-omar-01']}));
  assert.deepEqual(f.data.views.at(-1).surface, {type: 'album', album_id: 'al-reunion', link_id: null});
  rejected(f, ev('share.viewed', '2026-11-20T10:50:00-08:00', {view_id: 'vw-e', surface: {type: 'album', album_id: 'al-reunion'}, viewer: {person_id: 'person-ruth'}, viewed_item_ids: 'all'}), /not a joined member/);
  rejected(f, ev('share.viewed', '2026-11-20T10:50:00-08:00', {view_id: 'vw-e', surface: {type: 'album', album_id: 'al-reunion'}, viewer: {anonymous: true}, viewed_item_ids: 'all'}));
  rejected(f, ev('share.viewed', '2026-11-20T10:50:00-08:00', {view_id: 'vw-e', surface: {type: 'link', album_match: {title: 'Garden', person_id: 'person-kofi'}}, viewer: {anonymous: true}, viewed_item_ids: 'all'}), /found no album/);
  rejected(f, ev('share.viewed', '2026-11-20T10:50:00-08:00', {view_id: 'vw-e', surface: {type: 'link', album_match: {}}, viewer: {anonymous: true}, viewed_item_ids: 'all'}), /needs person_id/);
  // Revoke: the views stay recorded; a view after it is rejected; revoking again is invalid_state.
  assert.equal(f.call('fernshelf.links.revoke', {id: 'ln-n0002'}).state, 'revoked');
  refused(f, 'fernshelf.links.revoke', {id: 'ln-n0002'}, 'invalid_state');
  refused(f, 'fernshelf.links.revoke', {id: 'ln-zz'}, 'not_found');
  rejected(f, ev('share.viewed', '2026-11-20T11:00:00-08:00', {view_id: 'vw-f', surface: {type: 'link', id: 'ln-n0002'}, viewer: {anonymous: true}, viewed_item_ids: 'all'}), /revoked/);
  const exp = f.call('fernshelf.exposure.get', {id: 'it-m05'});
  assert.deepEqual([exp.albums[0].links.map(l => l.link_id), exp.views.map(v => v.view_id), exp.saves.map(v => v.view_id)], [['ln-n0001'], ['vw-a', 'vw-b'], ['vw-b']]);
  // Expiry by the clock alone: with no App event, the link reads expired and a view is rejected.
  const g = fixture();
  const l = g.call('fernshelf.links.create', {id: 'al-garden', expires_at: '2026-11-27T09:00:00-08:00'});
  const dataBefore = JSON.stringify(g.data);
  g.advance('2026-11-27T09:00:00-08:00');
  assert.equal(JSON.stringify(g.data), dataBefore, 'moving the clock changes no stored data');
  assert.equal(g.call('fernshelf.albums.get', {id: 'al-garden'}).album.links[0].state, 'expired');
  assert.deepEqual(g.call('fernshelf.exposure.get', {id: 'it-m05'}).albums, []);
  rejected(g, ev('share.viewed', '2026-11-27T09:00:00-08:00', {view_id: 'vw-g', surface: {type: 'link', id: l.id}, viewer: {anonymous: true}, viewed_item_ids: 'all'}), /expired/);
  rejected(g, ev('share.viewed', '2026-11-27T09:00:00-08:00', {view_id: 'vw-g', surface: {type: 'link', album_id: 'al-garden'}, viewer: {anonymous: true}, viewed_item_ids: 'all'}), /no active link/);
  refused(g, 'fernshelf.links.revoke', {id: l.id}, 'invalid_state');
});
