'use strict';
// T14 (the platform clock) and the App-side parts of T15 (invalid events, notifications, activity
// rows, seed validation, wire messages). Core-side parts of T15 (replayed request_id, idempotency
// conflicts, stale versions, Agent calls to Infra operations, reset) run on the real runtime in
// scripts/real-mcp.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {fixture, ev} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const {wireId} = require('../src/notify.cjs');
const minimal = require('../fixtures/minimal.json');
const binding = require('../fixtures/binding.json');

const ctx = {app_id: 'fernshelf', run_id: 'test', role: 'infra', binding, virtual_now: '2026-11-20T09:00:00-08:00'};

test('T14 the platform clock: after advance_time and no App event, trash reads purged, links expire, storage follows; the next commit changes nothing a read returns', () => {
  const f = fixture({mutate: d => { d.items.find(i => i.id === 'it-m09').file = 'asset-m09'; }});
  const reads = () => ({item: f.call('fernshelf.items.get', {id: 'it-m09'}), garden: f.call('fernshelf.albums.get', {id: 'al-garden'}).album,
    reunion: f.call('fernshelf.albums.get', {id: 'al-reunion'}).album, storage: f.call('fernshelf.storage.summary').storage,
    exposure: f.call('fernshelf.exposure.get', {id: 'it-m01'}), search: f.call('fernshelf.items.search', {state: 'purged'})});
  const strip = r => JSON.parse(JSON.stringify(r, (k, v) => (k === 'version' ? undefined : v)));
  const before = reads(), data = JSON.stringify(f.data), rows = f.data.activity.length;
  assert.deepEqual([before.item.item.state, before.item.item.file, before.reunion.links[0].state], ['trashed', {asset_id: 'asset-m09'}, 'active']);
  assert.equal(f.try('fernshelf.items.read', {id: 'it-m09'}).status, 'in_trash');
  f.advance('2027-01-01T00:00:00-08:00');
  assert.equal(JSON.stringify(f.data), data, 'business data unchanged by the clock');
  const after = reads();
  assert.deepEqual([after.item.item.state, after.item.item.purged_at, after.item.item.file], ['purged', '2026-12-10T20:00:00-08:00', null]);
  assert.equal(after.reunion.links[0].state, 'expired');
  assert.deepEqual(after.exposure.albums[0].links, []);
  assert.equal(after.storage.used_bytes, before.storage.used_bytes - 2800000);
  assert.equal(after.storage.trash_bytes, 0);
  assert.deepEqual(after.search.rows.map(r => r.id), ['it-m09', 'it-m10']);
  assert.equal(f.try('fernshelf.items.read', {id: 'it-m09'}).status, 'gone');
  assert.equal(f.data.activity.length, rows, 'no activity row for a time-driven change');
  assert.equal(f.data.items.find(i => i.id === 'it-m09').file, 'asset-m09', 'the stored reference stays until the next commit');
  assert.deepEqual(plugin.assetReferences(f.data), [], 'a trashed item\'s file is never offered to Core\'s resource reader');
  // The next committed write drops the stored file reference and the album record; reads are unchanged.
  f.call('fernshelf.albums.create', {title: 'Unrelated'});
  const m09 = f.data.items.find(i => i.id === 'it-m09');
  assert.deepEqual([m09.state, m09.file, m09.purged_at], ['purged', null, '2026-12-10T20:00:00-08:00']);
  assert.deepEqual(f.data.albums.find(a => a.id === 'al-garden').item_ids, ['it-m05']);
  assert.deepEqual(plugin.assetReferences(f.data), []);
  assert.deepEqual(strip(reads()), strip(after));
  assert.equal(f.data.activity.length, rows + 1, 'one row for the write, none for the settled purge');
});

test('T15 every invalid event of the plan is rejected with state and clock unchanged', () => {
  const f = fixture();
  f.call('fernshelf.links.revoke', {id: 'ln-m1'});
  const l2 = f.call('fernshelf.links.create', {id: 'al-reunion', expires_at: '2026-11-20T09:30:00-08:00'});
  f.call('fernshelf.albums.members.invite', {id: 'al-garden', person_id: 'person-lena', role: 'viewer'});
  const at = '2026-11-20T10:00:00-08:00';
  const cases = [
    ['event dated before the current time', ev('backup.resumed', '2026-11-19T10:00:00-08:00', {})],
    ['duplicate item ID', ev('item.added', at, {item_id: 'it-m01', kind: 'photo', taken_at: at, source: 'camera', declared_bytes: 10})],
    ['duplicate view ID', ev('share.viewed', at, {view_id: 'vw-m1', surface: {type: 'album', album_id: 'al-reunion'}, viewer: {person_id: 'person-kofi'}, viewed_item_ids: 'all'})],
    ['duplicate request ID', ev('removal.requested', at, {removal_id: 'rr-m1', from_person_id: 'person-dana', item_ids: ['it-m01'], scope: {type: 'everywhere'}})],
    ['unknown album', ev('member.changed', at, {album_id: 'al-x', person_id: 'person-kofi', change: 'leave'})],
    ['unknown member', ev('member.changed', at, {album_id: 'al-reunion', person_id: 'person-dana', change: 'leave'})],
    ['unknown link', ev('share.viewed', at, {view_id: 'vw-n', surface: {type: 'link', id: 'ln-x'}, viewer: {anonymous: true}, viewed_item_ids: 'all'})],
    ['unknown label', ev('item.added', at, {item_id: 'it-n', kind: 'photo', taken_at: at, source: 'camera', declared_bytes: 10, people: ['pl-x']})],
    ['unknown item', ev('removal.requested', at, {removal_id: 'rr-n', from_person_id: 'person-dana', item_ids: ['it-x'], scope: {type: 'everywhere'}})],
    ['match finds no album', ev('member.changed', at, {album_match: {title: 'Reunion 2026'}, person_id: 'person-lena', change: 'join'})],
    ['match finds no active link', ev('share.viewed', '2026-11-20T09:30:00-08:00', {view_id: 'vw-n', surface: {type: 'link', album_match: {person_id: 'person-kofi'}}, viewer: {anonymous: true}, viewed_item_ids: 'all'})],
    ['contribution from someone who is not a joined contributor', ev('contribution.changed', at, {album_id: 'al-reunion', person_id: 'person-kofi', add: [{item_id: 'ct-k', kind: 'photo', taken_at: at, declared_bytes: 10}]})],
    ['view of a revoked link', ev('share.viewed', at, {view_id: 'vw-n', surface: {type: 'link', id: 'ln-m1'}, viewer: {anonymous: true}, viewed_item_ids: 'all'})],
    ['view of an expired link', ev('share.viewed', '2026-11-20T09:30:00-08:00', {view_id: 'vw-n', surface: {type: 'link', id: l2.id}, viewer: {anonymous: true}, viewed_item_ids: 'all'})],
    ['view of an item the surface does not show', ev('share.viewed', at, {view_id: 'vw-n', surface: {type: 'album', album_id: 'al-reunion'}, viewer: {person_id: 'person-kofi'}, viewed_item_ids: ['it-m05']})],
    ['request naming no item of the account', ev('removal.requested', at, {removal_id: 'rr-n', from_person_id: 'person-dana', item_ids: ['ct-omar-01'], scope: {type: 'everywhere'}})],
    ['scope album that does not exist', ev('removal.requested', at, {removal_id: 'rr-n', from_person_id: 'person-dana', item_ids: ['it-m01'], scope: {type: 'album', album_id: 'al-x'}})],
    ['member change for someone who was not invited', ev('member.changed', at, {album_id: 'al-garden', person_id: 'person-dana', change: 'join'})],
    ['withdrawal of an unknown request', ev('removal.withdrawn', at, {removal_id: 'rr-x'})]
  ];
  for (const [name, e] of cases) {
    const before = JSON.stringify(f.data), now = f.now, revision = f.revision;
    const r = f.tryEvent(e);
    assert.equal(r.status, 'invalid_event', name + ': ' + r.message);
    assert.deepEqual([JSON.stringify(f.data), f.now, f.revision], [before, now, revision], name);
  }
  assert.equal(f.audit.filter(a => a.decision === 'deny').length, cases.length);
  // Withdrawing an honoured request is rejected too.
  f.call('fernshelf.removals.respond', {id: 'rr-m1', decision: 'honor'});
  assert.equal(f.tryEvent(ev('removal.withdrawn', at, {removal_id: 'rr-m1'})).status, 'invalid_event');
});

test('T15 notifications once per event and none for my own writes; activity rows for each write, event and effect, none for replays, refusals or time', () => {
  const f = fixture();
  const n0 = f.data.notifications.length;
  const rows = () => f.data.activity.length;
  // Every Agent write: exactly one activity row, no notification.
  const writes = [
    ['fernshelf.items.update', {id: 'it-m03', patch: {favorite: true}}],
    ['fernshelf.albums.create', {title: 'Walks'}],
    ['fernshelf.albums.update', {id: 'al-n0001', add_ids: ['it-m07', 'it-m08']}],
    ['fernshelf.albums.members.invite', {id: 'al-n0001', person_id: 'person-dana', role: 'contributor'}],
    ['fernshelf.albums.members.update', {id: 'al-n0001', person_id: 'person-dana', role: 'viewer'}],
    ['fernshelf.links.create', {id: 'al-n0001'}],
    ['fernshelf.links.revoke', {id: 'ln-n0001'}],
    ['fernshelf.albums.save_item', {id: 'al-reunion', item_id: 'ct-omar-01'}],
    ['fernshelf.items.trash', {ids: ['it-m07', 'it-m12']}],
    ['fernshelf.items.restore', {ids: ['it-m12']}],
    ['fernshelf.items.purge', {ids: ['it-m07'], confirm: true}],
    ['fernshelf.removals.respond', {id: 'rr-m1', decision: 'decline'}],
    ['fernshelf.albums.delete', {id: 'al-n0001', confirm: true}]
  ];
  for (const [name, args] of writes) {
    const k = rows();
    const r = f.call(name, args);
    assert.equal(r.status, 'committed', name);
    assert.equal(rows(), k + 1, 'one activity row for ' + name);
    const row = f.data.activity.at(-1);
    assert.deepEqual([row.actor, row.action, row.request_id], ['agent', name.slice(10), 'local-' + (writes.findIndex(w => w[0] === name) + 1)]);
  }
  assert.equal(f.data.notifications.length, n0, 'no notification for my own writes');
  // A refused write adds no row.
  const k = rows();
  f.try('fernshelf.items.trash', {ids: ['it-m07']});
  assert.equal(rows(), k);
  // Events: one row for the event and one per effect; one notification for each that notifies.
  const counts = [];
  const apply = (e, notifications) => {
    const before = f.data.notifications.length;
    f.event(e);
    assert.equal(f.data.notifications.length - before, notifications, e.operation);
    const own = f.data.activity.filter(a => a.event_id === e.event_id);
    assert.equal(own[0].action, 'event.' + e.operation.slice(10));
    assert.ok(own.slice(1).every(a => a.cause_seq === own[0].seq && a.action.startsWith('effect.')), e.operation);
    counts.push(own.length);
  };
  apply(ev('member.changed', '2026-11-20T10:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-kofi', change: 'leave'}, 'ev-a'), 1);
  apply(ev('contribution.changed', '2026-11-20T10:01:00-08:00', {album_id: 'al-reunion', person_id: 'person-omar', add: [{item_id: 'ct-o2', kind: 'photo', taken_at: '2026-11-14T17:00:00-08:00', declared_bytes: 5}]}, 'ev-b'), 1);
  apply(ev('share.viewed', '2026-11-20T10:02:00-08:00', {view_id: 'vw-x', surface: {type: 'link', id: 'ln-m1'}, viewer: {anonymous: true}, viewed_item_ids: 'all'}, 'ev-c'), 0);
  apply(ev('removal.requested', '2026-11-20T10:03:00-08:00', {removal_id: 'rr-z', from_person_id: 'person-ruth', item_ids: ['it-m13'], scope: {type: 'everywhere'}}, 'ev-d'), 1);
  apply(ev('removal.withdrawn', '2026-11-20T10:04:00-08:00', {removal_id: 'rr-z'}, 'ev-e'), 1);
  apply(ev('item.added', '2026-11-20T10:05:00-08:00', {item_id: 'it-new', kind: 'photo', taken_at: '2026-11-20T10:00:00-08:00', source: 'camera', declared_bytes: 5}, 'ev-f'), 0);
  apply(ev('backup.resumed', '2026-11-20T10:06:00-08:00', {}, 'ev-g'), 0);
  assert.deepEqual(counts, [3, 3, 1, 2, 2, 2, 1]);
  // A replayed event adds no row and no notification.
  const k2 = rows(), n2 = f.data.notifications.length;
  assert.equal(f.event(ev('member.changed', '2026-11-20T10:00:00-08:00', {album_id: 'al-reunion', person_id: 'person-kofi', change: 'leave'}, 'ev-a')).duplicate, true);
  assert.deepEqual([rows(), f.data.notifications.length], [k2, n2]);
  // Moving the clock adds nothing.
  f.advance('2027-06-01T00:00:00-07:00');
  assert.deepEqual([rows(), f.data.notifications.length], [k2, n2]);
});

test('T15 wire messages: stored only while email notices are on, valid against the Mail wire schema', () => {
  const wire = compile(require('../schemas/router-message.schema.json'), path.join(__dirname, '../schemas'));
  const on = fixture({mutate: d => { d.account.email_notices = true; }});
  on.event(ev('removal.requested', '2026-11-20T10:00:00-08:00', {removal_id: 'rr-0007', from_person_id: 'person-dana', item_ids: ['it-m01', 'it-m03'],
    scope: {type: 'album', album_id: 'al-reunion'}, message: 'Please take these down.'}));
  const n = on.data.notifications.at(-1);
  assert.ok(wire(n.wire), 'valid wire message');
  assert.deepEqual([n.wire.id, n.wire.source, n.wire.data.recipient, n.wire.data.source_object.object_id, n.wire.data.content.title],
    [wireId(n), 'urn:pale:app:fernshelf:account:fernshelf-maya', {kind: 'person_ref', id: 'person-maya'}, 'rr-0007', n.title]);
  const noRecipient = structuredClone(n.wire); delete noRecipient.data.recipient;
  const withAsset = structuredClone(n.wire); withAsset.data.content.asset_ids = ['asset-x'];
  assert.equal(wire(noRecipient), false);
  assert.equal(wire(withAsset), false);
  assert.equal(on.call('fernshelf.notifications.list', {kind: 'removal.requested'}).notifications.at(-1).email_message_stored, true);
  const off = fixture();
  off.event(ev('removal.requested', '2026-11-20T10:00:00-08:00', {removal_id: 'rr-0007', from_person_id: 'person-dana', item_ids: ['it-m01'], scope: {type: 'everywhere'}}));
  assert.equal(off.data.notifications.at(-1).wire, null);
});

test('T15 seed validation refuses inconsistent history', () => {
  const check = (name, mutate, c = ctx) => {
    const d = structuredClone(minimal);
    mutate(d);
    assert.throws(() => plugin.validateSeed(c, d), e => e.code === 'invalid_seed', name);
  };
  plugin.validateSeed(ctx, structuredClone(minimal));
  const it = (d, id) => d.items.find(i => i.id === id);
  check('duplicate item ID', d => d.items.push(structuredClone(it(d, 'it-m03'))));
  check('item ID equal to a contribution', d => { it(d, 'it-m08').id = 'ct-omar-01'; });
  check('duplicate album ID', d => d.albums.push(structuredClone(d.albums[1])));
  check('dangling album item', d => d.albums[1].item_ids.push('it-ghost'));
  check('dangling stack member', d => d.stacks[0].item_ids.push('it-ghost'));
  check('stack cover not one of its items', d => { d.stacks[0].cover_id = 'it-m03'; });
  check('stack cover in the trash', d => { d.stacks[1].cover_id = 'it-m09'; d.stacks[1].item_ids.push('it-m09'); });
  check('item in two stacks', d => d.stacks[1].item_ids.push('it-m01'));
  check('dangling label', d => it(d, 'it-m03').people.push('pl-ghost'));
  check('view of an unknown link', d => { d.views[0].surface.link_id = 'ln-ghost'; });
  check('view saving what it did not show', d => { d.views[0].saved_item_ids.push('it-m05'); });
  check('honoured request without cleared surfaces', d => { d.removals[0].state = 'honored'; d.removals[0].answers.push({decision: 'honor', note: null, at: '2026-11-17T09:00:00-08:00', request_id: null}); });
  check('trashed item without purge_at', d => { it(d, 'it-m09').purge_at = null; });
  check('item not backed up sitting in an album', d => { it(d, 'it-m03').backed_up = false; });
  check('item not backed up with a file', d => { Object.assign(it(d, 'it-m08'), {backed_up: false, file: 'asset-x'}); });
  check('purged item with a file', d => { Object.assign(it(d, 'it-m08'), {state: 'purged', purged_at: '2026-11-01T00:00:00Z', file: 'asset-x'}); });
  check('video with an image file', d => { it(d, 'it-m06').file = 'asset-x'; });
  check('present contribution from a member who left', d => { Object.assign(d.albums[0].members[1], {status: 'left', ended_at: '2026-11-16T00:00:00-08:00'}); });
  check('link of a deleted album still active', d => { d.albums[0].deleted_at = '2026-11-19T00:00:00-08:00'; });
  check('not_removable must match the request', d => { d.removals[0].not_removable = []; });
  check('member status and times disagree', d => { d.albums[0].members[0].joined_at = null; });
  check('account not declared by the binding', d => { d.account_id = 'fernshelf-other'; });
  check('owner not in the binding', d => { d.owner_person_id = 'person-ghost'; });
  check('activity sequence', d => { d.activity.push({seq: 2, at: '2026-11-20T00:00:00Z', actor: 'agent', action: 'x', object_ids: [], request_id: null, event_id: null, warnings: []},
    {seq: 2, at: '2026-11-20T00:00:00Z', actor: 'agent', action: 'x', object_ids: [], request_id: null, event_id: null, warnings: []}); });
  // Timestamps without a UTC offset are refused by the seed schema (Core answers invalid_seed).
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(__dirname, '../schemas'));
  const d = structuredClone(minimal); d.items[0].taken_at = '2026-11-14T16:41:10';
  assert.equal(seedValid(d), false);
  assert.equal(seedValid(structuredClone(minimal)), true);
});
