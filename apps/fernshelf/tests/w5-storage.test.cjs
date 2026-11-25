'use strict';
// W5 Storage, versions and trash: T13 (trash, restore, purge, items that are not backed up,
// storage.threshold).
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');

const USED = 851872400; // minimal.json: backed-up items that are active or trashed at 2026-11-20 09:00
const item = (f, id) => f.data.items.find(i => i.id === id);
const storage = f => f.call('fernshelf.storage.summary').storage;
function refused(f, name, args, code) {
  const before = f.revision, data = JSON.stringify(f.data), r = f.try(name, args);
  assert.equal(r.status, code, name + ' ' + JSON.stringify(args) + ' -> ' + r.message);
  assert.equal(f.revision, before, 'version unchanged after ' + code);
  assert.equal(JSON.stringify(f.data), data);
  return r;
}
const added = (at, payload, id) => ev('item.added', at, {kind: 'photo', taken_at: at, source: 'camera', ...payload}, id);
const thresholds = f => f.data.notifications.filter(n => n.kind === 'storage.threshold').map(n => n.level);

test('T13 trash, restore into the same albums, purge by the clock and now; storage before and after each', () => {
  const f = fixture();
  assert.equal(storage(f).used_bytes, USED);
  const t = f.call('fernshelf.items.trash', {ids: ['it-m03', 'it-m05']});
  assert.deepEqual(t.items, [{id: 'it-m03', state: 'trashed', purge_at: '2026-12-20T09:00:00-08:00'}, {id: 'it-m05', state: 'trashed', purge_at: '2026-12-20T09:00:00-08:00'}]);
  assert.deepEqual(t.covers_changed, [{stack_id: 'st-m2', cover_id: 'it-m04'}]);
  // They leave every album view and link at once; album records keep them; storage is unchanged.
  assert.deepEqual(f.call('fernshelf.albums.get', {id: 'al-reunion'}).album.entries.map(e => e.id), ['it-m01', 'ct-omar-01']);
  assert.deepEqual(f.call('fernshelf.albums.get', {id: 'al-garden'}).album.hidden_item_ids, ['it-m05', 'it-m09']);
  assert.deepEqual(f.data.albums[0].item_ids, ['it-m01', 'it-m03', 'ct-omar-01']);
  assert.equal(f.call('fernshelf.exposure.get', {id: 'it-m03'}).visible, false);
  let s = storage(f);
  assert.deepEqual([s.used_bytes, s.trash_bytes], [USED, 2800000 + 3950000 + 5300000]);
  // Restore: back in its album at its place.
  f.call('fernshelf.items.restore', {ids: ['it-m03']});
  assert.deepEqual(f.call('fernshelf.albums.get', {id: 'al-reunion'}).album.entries.map(e => e.id), ['it-m01', 'it-m03', 'ct-omar-01']);
  assert.deepEqual(f.call('fernshelf.exposure.get', {id: 'it-m03'}).visible_to, ['person-kofi', 'person-omar']);
  // The clock passes purge_at with no App event: purged, bytes freed, file gone, restore refused.
  f.advance('2026-12-20T09:00:00-08:00');
  assert.equal(f.call('fernshelf.items.get', {id: 'it-m05'}).item.state, 'purged');
  s = storage(f);
  assert.deepEqual([s.used_bytes, s.trash_bytes], [USED - 2800000 - 5300000, 0]);
  refused(f, 'fernshelf.items.read', {id: 'it-m05'}, 'gone');
  refused(f, 'fernshelf.items.restore', {ids: ['it-m05']}, 'gone');
  refused(f, 'fernshelf.items.purge', {ids: ['it-m05'], confirm: true}, 'gone');
  refused(f, 'fernshelf.items.trash', {ids: ['it-m05']}, 'gone');
  // items.purge: needs confirm, frees bytes at once, cannot be undone.
  f.call('fernshelf.items.trash', {ids: ['it-m07', 'it-m12']});
  refused(f, 'fernshelf.items.purge', {ids: ['it-m07', 'it-m12']}, 'confirm_required');
  refused(f, 'fernshelf.items.purge', {ids: ['it-m07', 'it-m12'], confirm: false}, 'confirm_required');
  refused(f, 'fernshelf.items.purge', {ids: ['it-m07', 'it-m01'], confirm: true}, 'invalid_state');
  const p = f.call('fernshelf.items.purge', {ids: ['it-m07', 'it-m12'], confirm: true});
  assert.deepEqual([p.freed_bytes, p.items.map(i => i.state)], [600000, ['purged', 'purged']]);
  assert.equal(storage(f).used_bytes, USED - 2800000 - 5300000 - 600000);
  assert.deepEqual([item(f, 'it-m07').purged_at, item(f, 'it-m07').history.at(-1).action], [f.now, 'purged']);
  refused(f, 'fernshelf.items.restore', {ids: ['it-m07']}, 'gone');
  // Other refusals and all-or-nothing batches.
  f.call('fernshelf.items.trash', {ids: ['it-m03']});
  refused(f, 'fernshelf.items.trash', {ids: ['it-m03']}, 'invalid_state');
  refused(f, 'fernshelf.items.restore', {ids: ['it-m01']}, 'invalid_state');
  refused(f, 'fernshelf.items.trash', {ids: ['it-m08', 'ct-omar-01']}, 'not_yours');
  refused(f, 'fernshelf.items.trash', {ids: ['it-m08', 'it-ghost']}, 'not_found');
  refused(f, 'fernshelf.items.restore', {ids: ['it-m03', 'it-m01']}, 'invalid_state');
  refused(f, 'fernshelf.items.trash', {ids: Array.from({length: 51}, (_, k) => 'it-x' + k)}, 'limit_exceeded');
  refused(f, 'fernshelf.items.purge', {ids: Array.from({length: 51}, (_, k) => 'it-x' + k), confirm: true}, 'limit_exceeded');
  assert.equal(item(f, 'it-m08').state, 'active', 'none of a refused batch changed');
});

test('T13 items that are not backed up: recorded past the quota, searchable, refused by albums, never exposed, unchanged by a purge, backed up only by an event', () => {
  // 1.05 GB free.
  const f = fixture({mutate: d => { d.account.quota_bytes = USED + 1050000000; }});
  f.event(added('2026-11-20T10:00:00-08:00', {item_id: 'it-big', kind: 'video', declared_bytes: 1200000000, width: 3840, height: 2160, duration_ms: 600000}));
  let s = storage(f);
  assert.deepEqual([item(f, 'it-big').backed_up, s.used_bytes, s.pending_bytes, s.pending_items], [false, USED, 1200000000, 1]);
  assert.deepEqual(thresholds(f), ['full']);
  assert.match(f.data.notifications.at(-1).body, /1 item \(1\.20 GB\) could not be backed up/);
  assert.deepEqual(f.call('fernshelf.items.search', {backed_up: false}).rows.map(r => r.id), ['it-big']);
  assert.equal(f.call('fernshelf.items.get', {id: 'it-big'}).item.backed_up, false);
  assert.deepEqual([f.call('fernshelf.exposure.get', {id: 'it-big'}).albums, f.call('fernshelf.exposure.get', {id: 'it-big'}).visible], [[], false]);
  refused(f, 'fernshelf.albums.update', {id: 'al-reunion', add_ids: ['it-big']}, 'not_backed_up');
  refused(f, 'fernshelf.items.read', {id: 'it-big'}, 'no_file');
  // It can be edited like any item.
  f.call('fernshelf.items.update', {id: 'it-big', patch: {caption: 'Recital, full length'}});
  // A new item that fits is backed up on arrival even while an older, larger one still waits: the
  // waiting pass runs first and stops at it-big; the new item is judged on its own bytes.
  f.event(added('2026-11-20T10:05:00-08:00', {item_id: 'it-mid', declared_bytes: 1000000000}));
  assert.deepEqual([item(f, 'it-mid').backed_up, item(f, 'it-big').backed_up, storage(f).used_bytes], [true, false, USED + 1000000000]);
  assert.deepEqual(thresholds(f), ['full', 80], 'it took used_bytes past 80%; no second "full" while it-big still waits');
  // One that does not fit waits behind it-big.
  f.event(added('2026-11-20T10:06:00-08:00', {item_id: 'it-small', declared_bytes: 100000000}));
  assert.deepEqual([item(f, 'it-small').backed_up, thresholds(f)], [false, ['full', 80]]);
  // Freeing space by purge lowers used_bytes at once and changes no backed_up flag.
  f.call('fernshelf.items.trash', {ids: ['it-mid']});
  assert.equal(f.call('fernshelf.items.purge', {ids: ['it-mid'], confirm: true}).freed_bytes, 1000000000);
  assert.deepEqual([storage(f).used_bytes, item(f, 'it-small').backed_up], [USED, false]);
  // backup.resumed stops at the first waiting item that does not fit: it-big (1.2 GB > 1.05 GB free)
  // stays, and so does it-small behind it although it alone would fit. Only the event's own row is written.
  const rows = f.data.activity.length;
  f.event(ev('backup.resumed', '2026-11-20T10:10:00-08:00', {}));
  assert.deepEqual([item(f, 'it-big').backed_up, item(f, 'it-small').backed_up, f.data.activity.length, thresholds(f)], [false, false, rows + 1, ['full', 80]]);
  f.call('fernshelf.items.trash', {ids: ['it-m06']});
  const p = f.call('fernshelf.items.purge', {ids: ['it-m06'], confirm: true});
  assert.equal(p.freed_bytes, 820000000);
  s = storage(f);
  assert.deepEqual([s.used_bytes, item(f, 'it-big').backed_up, s.pending_bytes], [USED - 820000000, false, 1300000000]);
  // The next sync backs both up, oldest first, one activity row each.
  f.event(ev('backup.resumed', '2026-11-20T11:00:00-08:00', {}, 'ev-sync'));
  assert.deepEqual([item(f, 'it-big').backed_up, item(f, 'it-small').backed_up], [true, true]);
  assert.deepEqual(f.data.activity.filter(a => a.event_id === 'ev-sync').map(a => [a.action, a.object_ids[0] || null]),
    [['event.backup.resumed', null], ['effect.item.backed_up', 'it-big'], ['effect.item.backed_up', 'it-small']]);
  s = storage(f);
  assert.deepEqual([s.used_bytes, s.pending_bytes], [USED - 820000000 + 1300000000, 0]);
  assert.equal(item(f, 'it-big').history.at(-1).action, 'backed_up');
  // Near the quota: 8.1 MB free; a 9 MB item waits, then a 1 kB item is backed up on arrival.
  const q = fixture({mutate: d => { d.account.quota_bytes = 860000000; }});
  q.event(added('2026-11-20T10:00:00-08:00', {item_id: 'it-w1', kind: 'video', declared_bytes: 9000000}));
  q.event(added('2026-11-20T10:05:00-08:00', {item_id: 'it-w2', declared_bytes: 1000}));
  assert.deepEqual([item(q, 'it-w1').backed_up, item(q, 'it-w2').backed_up, storage(q).used_bytes, storage(q).pending_bytes, thresholds(q)],
    [false, true, USED + 1000, 9000000, ['full']]);
  // An item trashed while it waits is not backed up later and frees no bytes when purged.
  const g = fixture({mutate: d => { d.account.quota_bytes = USED + 1000; }});
  g.event(added('2026-11-20T10:00:00-08:00', {item_id: 'it-w', declared_bytes: 5000}));
  g.call('fernshelf.items.trash', {ids: ['it-w']});
  g.call('fernshelf.items.trash', {ids: ['it-m06']});
  g.call('fernshelf.items.purge', {ids: ['it-m06'], confirm: true});
  g.event(ev('backup.resumed', '2026-11-20T10:30:00-08:00', {}));
  assert.equal(item(g, 'it-w').backed_up, false);
  assert.equal(storage(g).pending_bytes, 0, 'a trashed item is not waiting');
  assert.equal(g.call('fernshelf.items.purge', {ids: ['it-w'], confirm: true}).freed_bytes, 0);
  // An item that fits when nothing waits is backed up on arrival.
  const h = fixture();
  h.event(added('2026-11-20T10:00:00-08:00', {item_id: 'it-ok', declared_bytes: 5000, stack: {stack_id: 'st-m1', kind: 'burst'}}));
  assert.deepEqual([item(h, 'it-ok').backed_up, storage(h).used_bytes, h.data.notifications.length], [true, USED + 5000, 1]);
  assert.deepEqual(h.data.stacks.find(x => x.id === 'st-m1').item_ids, ['it-m01', 'it-m02', 'it-ok']);
});

test('T13 storage.threshold at 80%: once per crossing, written only by events', () => {
  const quota = Math.ceil(USED / 0.8) + 10000000; // just under 80% used
  const f = fixture({mutate: d => { d.account.quota_bytes = quota; }});
  assert.ok(USED < 0.8 * quota);
  f.event(added('2026-11-20T10:00:00-08:00', {item_id: 'it-a', declared_bytes: 20000000}));
  assert.deepEqual(thresholds(f), [80]);
  assert.match(f.data.notifications.at(-1).title, /80% full/);
  f.event(added('2026-11-20T10:01:00-08:00', {item_id: 'it-b', declared_bytes: 1000000}));
  assert.deepEqual(thresholds(f), [80], 'already above: no second notification');
  // My own purge takes it back below 80%: no notification for my write; the next crossing by an event notifies again.
  f.call('fernshelf.items.trash', {ids: ['it-m06']});
  f.call('fernshelf.items.purge', {ids: ['it-m06'], confirm: true});
  assert.deepEqual(thresholds(f), [80]);
  f.event(added('2026-11-20T10:02:00-08:00', {item_id: 'it-c', kind: 'video', declared_bytes: 830000000, width: 1920, height: 1080, duration_ms: 60000}));
  assert.deepEqual(thresholds(f), [80, 80]);
  // Crossing 80% and later leaving an item waiting are separate notifications with their own levels.
  const g = fixture({mutate: d => { d.account.quota_bytes = quota; }});
  g.event(added('2026-11-20T10:00:00-08:00', {item_id: 'it-a', declared_bytes: 20000000}));
  g.event(added('2026-11-20T10:01:00-08:00', {item_id: 'it-huge', kind: 'video', declared_bytes: 9000000000, width: 1920, height: 1080, duration_ms: 60000}));
  assert.deepEqual(thresholds(g), [80, 'full']);
  // The clock alone never writes a notification.
  const n = g.data.notifications.length;
  g.advance('2027-02-01T00:00:00-08:00');
  assert.equal(g.data.notifications.length, n);
  // Invalid item.added events.
  const bad = (payload, pattern) => {
    const r = g.tryEvent(added('2027-02-01T00:00:00-08:00', {item_id: 'it-new', declared_bytes: 1000, ...payload}));
    assert.equal(r.status, 'invalid_event');
    if (pattern) assert.match(r.message, pattern);
  };
  bad({item_id: 'it-m01'}, /Duplicate item/);
  bad({item_id: 'ct-omar-01'}, /Duplicate item/);
  bad({people: ['pl-ghost']}, /Unknown people label/);
  bad({taken_at: '2027-02-02T00:00:00-08:00'}, /taken after/);
  bad({stack: {stack_id: 'st-m1', kind: 'edit'}}, /burst stack/);
  bad({duration_ms: 1000}, /no duration/);
  assert.equal(g.tryEvent(added('2027-01-31T00:00:00-08:00', {item_id: 'it-old', declared_bytes: 1000})).status, 'invalid_event', 'an event dated before the current time');
});
