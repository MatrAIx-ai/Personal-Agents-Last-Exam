'use strict';
// W4 Removal requests and what stays visible: T11 (requests and answers) and T12 (warnings).
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, business, ev} = require('./harness.cjs');

const album = (f, id) => f.data.albums.find(a => a.id === id);
const removal = (f, id) => f.data.removals.find(r => r.id === id);
function refused(f, name, args, code) {
  const before = f.revision, r = f.try(name, args);
  assert.equal(r.status, code, name + ' ' + JSON.stringify(args) + ' -> ' + r.message);
  assert.equal(f.revision, before, 'version unchanged after ' + code);
  return r;
}
function rejected(f, e, pattern) {
  const before = f.revision, r = f.tryEvent(e);
  assert.equal(r.status, 'invalid_event', JSON.stringify(e.payload) + ' -> ' + r.message);
  if (pattern) assert.match(r.message, pattern);
  assert.equal(f.revision, before);
  return r;
}
const requested = (at, payload, id) => ev('removal.requested', at, payload, id);
// A second shared album that also holds it-m01 (Dana joined), and a private one that holds it too.
const twoAlbums = d => {
  d.albums.push({id: 'al-family', title: 'Family', created_at: '2026-11-15T08:00:00-08:00', created_by: 'seed', request_id: null, item_ids: ['it-m01', 'it-m13'],
    members: [{person_id: 'person-ruth', role: 'viewer', status: 'joined', invited_at: '2026-11-15T08:00:00-08:00', joined_at: '2026-11-15T09:00:00-08:00', ended_at: null, history: []}],
    contributions: [], deleted_at: null});
  d.albums.find(a => a.id === 'al-garden').item_ids.push('it-m01');
};

test('T11 removal requests: album scope by ID, honour clears that album only, not_removable, already seen, invalid_state', () => {
  const f = fixture({mutate: twoAlbums});
  const before = business(f.data);
  f.event(requested('2026-11-20T09:20:00-08:00', {removal_id: 'rr-0007', from_person_id: 'person-dana', item_ids: ['it-m01', 'it-m03', 'ct-omar-01'],
    scope: {type: 'album', album_id: 'al-reunion'}, message: 'Please take these down, I would rather they were not shared.'}));
  const r = removal(f, 'rr-0007');
  assert.deepEqual([r.state, r.not_removable, r.scope], ['pending', ['ct-omar-01'], {type: 'album', album_id: 'al-reunion'}]);
  assert.deepEqual(business(f.data).albums, before.albums, 'a request changes no album');
  const n = f.data.notifications.at(-1);
  assert.deepEqual([n.kind, n.object_id, n.title], ['removal.requested', 'rr-0007', 'Dana Ilvesmaa asked you to take down 3 photos']);
  assert.match(n.body, /from the shared album Reunion 2026\. Their note: Please take these down/);
  // exposure.get previews what honour will clear.
  assert.deepEqual(f.call('fernshelf.exposure.get', {id: 'it-m01'}).albums.map(a => a.album_id), ['al-reunion', 'al-family']);
  const ans = f.call('fernshelf.removals.respond', {id: 'rr-0007', decision: 'honor', note: 'Done for the reunion album.'});
  assert.equal(ans.state, 'honored');
  assert.deepEqual(ans.cleared, [{item_id: 'it-m01', album_ids: ['al-reunion'], link_ids: ['ln-m1']}, {item_id: 'it-m03', album_ids: ['al-reunion'], link_ids: ['ln-m1']}]);
  assert.deepEqual(ans.not_removable, ['ct-omar-01']);
  // What cannot be undone: Kofi's earlier view and save.
  assert.deepEqual(ans.already_seen.map(x => [x.item_id, x.views.map(v => v.viewer.person_id + '@' + v.at), x.saves.map(v => v.view_id)]),
    [['it-m01', ['person-kofi@2026-11-15T20:14:00-08:00'], ['vw-m1']], ['it-m03', ['person-kofi@2026-11-15T20:14:00-08:00'], []]]);
  assert.deepEqual(album(f, 'al-reunion').item_ids, ['ct-omar-01'], 'the two items that are mine left; the contribution stays');
  assert.deepEqual(album(f, 'al-family').item_ids, ['it-m01', 'it-m13'], 'no other album is touched');
  assert.deepEqual(album(f, 'al-garden').item_ids, ['it-m05', 'it-m09', 'it-m01']);
  for (const id of ['it-m01', 'it-m03']) {
    const h = f.data.items.find(i => i.id === id).removal_history;
    assert.deepEqual(h, [{removal_id: 'rr-0007', person_id: 'person-dana', album_ids: ['al-reunion'], at: f.now}]);
  }
  assert.deepEqual(f.call('fernshelf.exposure.get', {id: 'it-m01'}).albums.map(a => a.album_id), ['al-family']);
  assert.deepEqual(f.call('fernshelf.exposure.get', {id: 'it-m01'}).views.map(v => v.view_id), ['vw-m1'], 'the view stays recorded');
  const listed = f.call('fernshelf.removals.list', {state: 'honored'}).removals[0];
  assert.deepEqual([listed.id, listed.answers.length, listed.cleared.length, listed.honored_at], ['rr-0007', 1, 2, f.now]);
  const act = f.data.activity.at(-1);
  assert.deepEqual([act.action, act.object_ids, act.details.decision], ['removals.respond', ['rr-0007', 'it-m01', 'it-m03'], 'honor']);
  // An honoured request is not reopened.
  refused(f, 'fernshelf.removals.respond', {id: 'rr-0007', decision: 'honor'}, 'invalid_state');
  refused(f, 'fernshelf.removals.respond', {id: 'rr-0007', decision: 'decline'}, 'invalid_state');
  refused(f, 'fernshelf.removals.respond', {id: 'rr-none', decision: 'decline'}, 'not_found');
  // A withdrawal after the answer is rejected.
  rejected(f, ev('removal.withdrawn', '2026-11-20T10:00:00-08:00', {removal_id: 'rr-0007'}), /honored/);
});

test('T11 scope everywhere, scope by album_match, decline then honour, withdrawal, invalid requests', () => {
  const f = fixture({mutate: twoAlbums});
  // A link on al-garden makes it shared with someone; a private album that holds the item is left alone.
  f.call('fernshelf.links.create', {id: 'al-garden'});
  const quiet = f.call('fernshelf.albums.create', {title: 'Just for me'});
  f.call('fernshelf.albums.update', {id: quiet.id, add_ids: ['it-m01']});
  f.event(requested('2026-11-20T09:30:00-08:00', {removal_id: 'rr-all', from_person_id: 'person-dana', item_ids: ['it-m01'], scope: {type: 'everywhere'}}));
  assert.match(f.data.notifications.at(-1).body, /everywhere they are shared/);
  const ans = f.call('fernshelf.removals.respond', {id: 'rr-all', decision: 'honor'});
  assert.deepEqual(ans.cleared, [{item_id: 'it-m01', album_ids: ['al-reunion', 'al-garden', 'al-family'], link_ids: ['ln-m1', 'ln-n0001']}]);
  assert.deepEqual(album(f, quiet.id).item_ids, ['it-m01'], 'an album shared with no one is never touched');
  assert.equal(f.call('fernshelf.exposure.get', {id: 'it-m01'}).visible, false);
  assert.ok(f.call('fernshelf.items.search', {}).rows.some(x => x.id === 'it-m01'), 'the library itself is never touched');
  // Album scope by album_match; decline, then honour later.
  const g = fixture({mutate: twoAlbums});
  g.event(requested('2026-11-20T09:30:00-08:00', {removal_id: 'rr-fam', from_person_id: 'person-kofi', item_ids: ['it-m13'], scope: {type: 'album', album_match: {title: 'family'}}}));
  assert.deepEqual(removal(g, 'rr-fam').scope, {type: 'album', album_id: 'al-family'});
  assert.equal(g.data.activity.find(a => a.event_id && a.action === 'event.removal.requested' && a.object_ids[0] === 'rr-fam').details.resolved_by_match, true);
  const dec = g.call('fernshelf.removals.respond', {id: 'rr-fam', decision: 'decline', note: 'It is a family picture; I will talk to you.'});
  assert.deepEqual([dec.state, dec.cleared, removal(g, 'rr-fam').answers[0].note], ['declined', [], 'It is a family picture; I will talk to you.']);
  assert.deepEqual(album(g, 'al-family').item_ids, ['it-m01', 'it-m13'], 'decline changes nothing');
  refused(g, 'fernshelf.removals.respond', {id: 'rr-fam', decision: 'decline'}, 'invalid_state');
  const later = g.call('fernshelf.removals.respond', {id: 'rr-fam', decision: 'honor'});
  assert.deepEqual([later.state, later.cleared, removal(g, 'rr-fam').answers.map(a => a.decision)], ['honored', [{item_id: 'it-m13', album_ids: ['al-family'], link_ids: []}], ['decline', 'honor']]);
  // An album that is shared with no one at the time of the answer is not touched by an album-scope honour.
  const h = fixture();
  h.event(requested('2026-11-20T09:30:00-08:00', {removal_id: 'rr-g', from_person_id: 'person-ruth', item_ids: ['it-m05'], scope: {type: 'album', album_id: 'al-garden'}}));
  assert.deepEqual(h.call('fernshelf.removals.respond', {id: 'rr-g', decision: 'honor'}).cleared, [{item_id: 'it-m05', album_ids: [], link_ids: []}]);
  assert.deepEqual(album(h, 'al-garden').item_ids, ['it-m05', 'it-m09']);
  // Withdrawal of a pending request closes it and changes no album.
  h.event(requested('2026-11-20T09:40:00-08:00', {removal_id: 'rr-w', from_person_id: 'person-dana', item_ids: ['it-m03'], scope: {type: 'everywhere'}}));
  const albumsBefore = JSON.stringify(h.data.albums);
  h.event(ev('removal.withdrawn', '2026-11-20T09:50:00-08:00', {removal_id: 'rr-w', message: 'It\'s fine, leave the group one up.'}));
  assert.deepEqual([removal(h, 'rr-w').state, removal(h, 'rr-w').withdrawn_at, JSON.stringify(h.data.albums)], ['withdrawn', '2026-11-20T09:50:00-08:00', albumsBefore]);
  assert.deepEqual([h.data.notifications.at(-1).kind, h.data.notifications.at(-1).title], ['removal.withdrawn', 'Dana Ilvesmaa withdrew a removal request']);
  refused(h, 'fernshelf.removals.respond', {id: 'rr-w', decision: 'honor'}, 'invalid_state');
  rejected(h, ev('removal.withdrawn', '2026-11-20T09:55:00-08:00', {removal_id: 'rr-w'}), /withdrawn/);
  rejected(h, ev('removal.withdrawn', '2026-11-20T09:55:00-08:00', {removal_id: 'rr-none'}), /Unknown removal/);
  // Invalid requests.
  const bad = (payload, pattern) => rejected(h, requested('2026-11-20T10:00:00-08:00', {removal_id: 'rr-x', from_person_id: 'person-dana', item_ids: ['it-m03'], scope: {type: 'everywhere'}, ...payload}), pattern);
  bad({removal_id: 'rr-m1'}, /Duplicate removal/);
  bad({from_person_id: 'person-ghost'}, /Unknown person/);
  bad({item_ids: ['it-m03', 'it-ghost']}, /Unknown item/);
  bad({item_ids: ['ct-omar-01']}, /names no item of this account/);
  bad({scope: {type: 'album', album_id: 'al-ghost'}}, /Unknown album/);
  bad({scope: {type: 'album', album_match: {title: 'No such album'}}}, /found no album/);
  h.call('fernshelf.albums.delete', {id: 'al-garden'});
  bad({scope: {type: 'album', album_id: 'al-garden'}}, /was deleted/);
});

test('T12 warnings: every write that would show an item with an honoured request; one per person and item; none for other states', () => {
  const f = fixture({mutate: twoAlbums});
  f.event(requested('2026-11-20T09:20:00-08:00', {removal_id: 'rr-0007', from_person_id: 'person-dana', item_ids: ['it-m01', 'it-m03'], scope: {type: 'album', album_id: 'al-reunion'}}));
  f.call('fernshelf.removals.respond', {id: 'rr-0007', decision: 'honor'});
  // Pending, declined and withdrawn requests from Kofi and Ruth about the same items produce no warning.
  f.event(requested('2026-11-20T09:30:00-08:00', {removal_id: 'rr-k', from_person_id: 'person-kofi', item_ids: ['it-m01'], scope: {type: 'everywhere'}}));
  f.event(requested('2026-11-20T09:31:00-08:00', {removal_id: 'rr-r', from_person_id: 'person-ruth', item_ids: ['it-m01'], scope: {type: 'everywhere'}}));
  f.call('fernshelf.removals.respond', {id: 'rr-r', decision: 'decline'});
  f.event(requested('2026-11-20T09:32:00-08:00', {removal_id: 'rr-o', from_person_id: 'person-omar', item_ids: ['it-m03'], scope: {type: 'everywhere'}}));
  f.event(ev('removal.withdrawn', '2026-11-20T09:33:00-08:00', {removal_id: 'rr-o'}));
  const expect = (warnings, pairs) => assert.deepEqual(warnings.map(w => [w.code, w.item_id, w.person_id, w.removal_id]), pairs.map(([i, p]) => ['removal_honored', i, p, 'rr-0007']));
  // albums.update adding to an album with a joined member: accepted, one warning, recorded on the activity row.
  const up = f.call('fernshelf.albums.update', {id: 'al-reunion', add_ids: ['it-m01', 'it-m05']});
  expect(up.warnings, [['it-m01', 'person-dana']]);
  assert.ok(up.item_ids.includes('it-m01'), 'the write is accepted');
  assert.deepEqual(f.data.activity.at(-1).warnings, up.warnings);
  // Adding to an album shared with no one: no warning.
  const mineOnly = f.call('fernshelf.albums.create', {title: 'Private picks'});
  assert.deepEqual(f.call('fernshelf.albums.update', {id: mineOnly.id, add_ids: ['it-m01', 'it-m03']}).warnings, []);
  // links.create and albums.members.invite: one warning per item the album shows.
  expect(f.call('fernshelf.links.create', {id: mineOnly.id}).warnings, [['it-m01', 'person-dana'], ['it-m03', 'person-dana']]);
  expect(f.call('fernshelf.albums.members.invite', {id: mineOnly.id, person_id: 'person-lena', role: 'viewer'}).warnings, [['it-m01', 'person-dana'], ['it-m03', 'person-dana']]);
  // An album with only an invited member counts as shared for an added item.
  const invitedOnly = f.call('fernshelf.albums.create', {title: 'Invite only'});
  f.call('fernshelf.albums.members.invite', {id: invitedOnly.id, person_id: 'person-lena', role: 'viewer'});
  expect(f.call('fernshelf.albums.update', {id: invitedOnly.id, add_ids: ['it-m03']}).warnings, [['it-m03', 'person-dana']]);
  // Restoring a trashed item back into a shared album warns too.
  f.call('fernshelf.items.trash', {ids: ['it-m03']});
  expect(f.call('fernshelf.items.restore', {ids: ['it-m03']}).warnings, [['it-m03', 'person-dana']]);
  // Two honoured requests from the same person about one item give one warning; another person adds one.
  f.event(requested('2026-11-20T09:40:00-08:00', {removal_id: 'rr-0008', from_person_id: 'person-dana', item_ids: ['it-m01'], scope: {type: 'everywhere'}}));
  f.call('fernshelf.removals.respond', {id: 'rr-0008', decision: 'honor'});
  f.call('fernshelf.removals.respond', {id: 'rr-k', decision: 'honor'});
  const both = f.call('fernshelf.albums.update', {id: 'al-family', add_ids: ['it-m01']}).warnings;
  assert.deepEqual(both.map(w => [w.item_id, w.person_id, w.removal_id]), [['it-m01', 'person-kofi', 'rr-k'], ['it-m01', 'person-dana', 'rr-0008']]);
  assert.match(both[1].message, /Dana Ilvesmaa/);
  // A role change shows nothing new and returns no warnings field.
  assert.equal(f.call('fernshelf.albums.members.update', {id: 'al-family', person_id: 'person-ruth', role: 'contributor'}).warnings, undefined);
});
