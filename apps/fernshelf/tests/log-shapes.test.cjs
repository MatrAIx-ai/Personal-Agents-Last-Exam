'use strict';
// The activity rows the App writes, collected from every write and event of the business tests
// (they run before this file), against the table scripts/check-fixtures.cjs uses to accept a seeded
// log. Both directions: every row the App wrote has a shape the table accepts, and every shape in
// the table was written by the App in some test, so the table can neither drift from the App nor
// allow a row the App cannot produce.
const test = require('node:test'), assert = require('node:assert/strict');
const {fixture, written, ev} = require('./harness.cjs');
const {SHAPES, shapeOk} = require('../scripts/check-fixtures.cjs');

test('the fixture checker accepts exactly the activity rows the App writes', () => {
  // A few rows the workflow tests do not happen to write: a new stack from the device, a device sync
  // with waiting items, a member's own withdrawal of a contribution, an album renamed or reordered
  // on its own, and deleting an album.
  const f = fixture({seed: 'minimal'});
  const before = f.data, quota = before.account.quota_bytes;
  const used = f.call('fernshelf.storage.summary').storage.used_bytes;
  f.event(ev('item.added', '2026-11-20T09:58:00-08:00', {item_id: 'it-shape-0', kind: 'photo', taken_at: '2026-11-20T09:00:00-08:00', source: 'camera', declared_bytes: 1000, stack: {stack_id: 'st-shape', kind: 'burst'}}));
  f.event(ev('item.added', '2026-11-20T10:00:00-08:00', {item_id: 'it-shape-1', kind: 'photo', taken_at: '2026-11-20T09:00:00-08:00', source: 'camera', declared_bytes: quota - used + 1}));
  f.event(ev('backup.resumed', '2026-11-20T10:05:00-08:00', {}));
  const album = before.albums.find(a => a.members.some(m => m.status === 'joined' && m.role === 'contributor') && a.contributions.some(k => !k.removed_at));
  if (album) {
    const k = album.contributions.find(x => !x.removed_at && album.members.some(m => m.person_id === x.person_id && m.status === 'joined' && m.role === 'contributor'));
    if (k) f.event(ev('contribution.changed', '2026-11-20T10:10:00-08:00', {album_id: album.id, person_id: k.person_id, remove: [k.id]}));
  }
  const made = f.call('fernshelf.albums.create', {title: 'Shapes'});
  const two = f.data.items.filter(i => i.state === 'active' && i.backed_up).slice(0, 2).map(i => i.id);
  f.call('fernshelf.albums.update', {id: made.id, add_ids: two});
  f.call('fernshelf.albums.update', {id: made.id, order: two.slice().reverse()});
  f.call('fernshelf.albums.update', {id: made.id, title: 'Shapes, renamed'});
  f.call('fernshelf.albums.delete', {id: made.id});
  const rows = [...written.values()];
  const odd = rows.filter(r => !shapeOk(r)).map(r => [r.action, r.actor, r.details && Object.keys(r.details)]);
  assert.deepEqual(odd, [], 'rows the App wrote that the checker would refuse');
  const seen = new Set(rows.map(r => r.action + '|' + (r.details ? Object.keys(r.details).sort().join(',') : '-')));
  const unwritten = Object.entries(SHAPES).flatMap(([action, s]) => s.details.map(k => action + '|' + (k ? k.join(',') : '-'))).filter(k => !seen.has(k));
  assert.deepEqual(unwritten, [], 'shapes the checker accepts that no test saw the App write');
});
