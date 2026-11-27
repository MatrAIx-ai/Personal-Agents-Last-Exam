'use strict';
// The acceptance plan on the reference fixture (fixtures/reference.json at 2026-11-20 09:00 -08:00),
// one test per workflow row: the main path and its controls. Also: the fixture matches its builder
// and passes the consistency script.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {fixture, ev} = require('./harness.cjs');
const {build} = require('../scripts/build-reference-fixture.cjs');
const {run: checkFixtures, problemsOf} = require('../scripts/check-fixtures.cjs');
const catalog = require('../contribution/assets.catalog.json');
const reference = require('../fixtures/reference.json');

const GB = 1e9;
const duplicateStacks = reference.stacks.filter(s => s.kind === 'duplicate');
const DUPLICATES = duplicateStacks.map(s => s.item_ids.find(id => id !== s.cover_id));
const inTwo = DUPLICATES.find(id => reference.albums.filter(a => a.item_ids.includes(id)).length === 2);
function refused(f, name, args, code) {
  const before = f.revision, r = f.try(name, args);
  assert.equal(r.status, code, name + ' ' + JSON.stringify(args).slice(0, 200) + ' -> ' + r.message);
  assert.equal(f.revision, before, 'version unchanged after ' + code);
  return r;
}
const rejected = (f, e) => { const before = f.revision, r = f.tryEvent(e); assert.equal(r.status, 'invalid_event', r.message); assert.equal(f.revision, before); };

test('reference fixture matches its builder and passes the consistency script', () => {
  assert.deepEqual(build({check: true}), []);
  assert.deepEqual(checkFixtures().problems, []);
});

test('consistency script refuses a history the App would not have produced, in either fixture', () => {
  const minimal = require('../fixtures/minimal.json');
  const altered = (data, change) => { const copy = structuredClone(data); change(copy); return problemsOf('altered', copy); };
  const refuses = (data, change, pattern) => assert.ok(altered(data, change).some(x => pattern.test(x)), String(pattern));
  assert.deepEqual(problemsOf('reference', reference), []);
  assert.deepEqual(problemsOf('minimal', minimal), []);
  const item = (d, id) => d.items.find(i => i.id === id);
  // Dates: the 2025-01-01 floor and the account's opening, for hand-written and generated records alike.
  refuses(reference, d => { d.albums[0].created_at = '2024-12-30T10:00:00-08:00'; }, /before 2025-01-01/);
  refuses(minimal, d => { d.links[0].created_at = '2025-12-30T10:00:00-08:00'; }, /before the account was opened/);
  // An item trashed before it was added, in either fixture.
  refuses(reference, d => { const i = item(d, 'it-2611-0958'); i.trashed_at = i.history[1].at = '2026-11-19T08:30:00-08:00'; i.purge_at = '2026-12-19T08:30:00-08:00'; }, /history/);
  refuses(minimal, d => { const i = item(d, 'it-m09'); i.trashed_at = i.history[1].at = '2026-08-30T09:00:00-07:00'; i.purge_at = '2026-09-29T09:00:00-07:00'; }, /history/);
  // A view through a link after it expired or was revoked, or by someone who had not joined.
  refuses(reference, d => { d.views.find(v => v.id === 'vw-0001').at = '2025-07-20T10:00:00-07:00'; }, /link was not active/);
  refuses(minimal, d => { d.links[0].revoked_at = '2026-11-15T13:00:00-08:00'; d.links[0].revoke_reason = 'revoked'; }, /link was not active/);
  refuses(reference, d => { d.views.find(v => v.id === 'vw-0011').at = '2025-07-21T07:00:00-07:00'; }, /not a joined member then/);
  // A member who joined before being invited; an honour on an album that was not shared then.
  refuses(minimal, d => { d.albums[0].members[0].joined_at = d.albums[0].members[0].history[1].at = '2026-11-14T19:00:00-08:00'; }, /member times/);
  refuses(reference, d => { const r = d.removals.find(x => x.id === 'rr-0010'); r.honored_at = r.answers[0].at = '2025-12-20T10:00:00-08:00'; }, /not shared then/);
  // Storage over the quota at some point in the past.
  refuses(reference, d => { d.account.quota_bytes = 5e9; }, /over the quota/);
  // The log: a missing row, an album item that never entered its album, a missing or extra notification.
  refuses(reference, d => { d.activity = d.activity.filter(r => r.action !== 'links.revoke'); }, /links.revoke/);
  refuses(reference, d => { d.activity = d.activity.filter(r => !(r.action === 'albums.update' && r.object_ids[0] === 'al-pip')); }, /never entered al-pip/);
  refuses(reference, d => { d.notifications = d.notifications.filter(n => n.kind !== 'storage.threshold'); }, /notifications do not match/);
  refuses(reference, d => { d.notifications.push({...d.notifications[0], id: 'ntf-0999'}); }, /notifications do not match/);
});

test('consistency script refuses a seeded log the App could not have written', () => {
  const altered = change => { const copy = structuredClone(reference); change(copy); return problemsOf('altered', copy); };
  const refuses = (change, pattern) => { const found = altered(change); assert.ok(found.some(x => pattern.test(x)), String(pattern) + ' in ' + JSON.stringify(found.slice(0, 5))); };
  const row = (d, f) => d.activity.find(f);
  // An action, a details key or an actor the App never writes.
  refuses(d => { row(d, r => r.action === 'event.item.added').action = 'device.synced'; }, /not a row the App writes/);
  refuses(d => { row(d, r => r.action === 'links.create').details = {expires_at: '2026-12-01T00:00:00-08:00'}; }, /not a row the App writes/);
  refuses(d => { const r = row(d, x => x.action === 'event.member.changed'); r.details.contributions_removed = []; }, /not a row the App writes/);
  refuses(d => { row(d, r => r.action === 'event.share.viewed').actor = 'agent'; }, /not a row the App writes/);
  refuses(d => { delete row(d, r => r.action === 'effect.item.backed_up').cause_seq; }, /not a row the App writes/);
  // A seeded row that looks like one written during a run.
  refuses(d => { row(d, r => r.action === 'items.update').request_id = 'req-1'; }, /carries a request or event ID/);
  // A happening without the rows the App writes for it: an arrival's backup, a stack, a join, a
  // member's contributions leaving with them, a contribution.
  refuses(d => { const r = row(d, x => x.action === 'effect.item.backed_up'); d.activity = d.activity.filter(x => x !== r); }, /no backup effect/);
  refuses(d => { const r = row(d, x => x.action === 'effect.stack.joined'); d.activity = d.activity.filter(x => x !== r); }, /effect\.stack\.joined/);
  refuses(d => { const r = row(d, x => x.action === 'effect.member.joined'); d.activity = d.activity.filter(x => x !== r); }, /effect\.member\.joined/);
  refuses(d => { const r = row(d, x => x.action === 'effect.contributions.removed'); d.activity = d.activity.filter(x => x !== r); }, /contributions that left/);
  refuses(d => { const r = row(d, x => x.action === 'effect.contributions.added'); d.activity = d.activity.filter(x => x !== r); }, /effect\.contributions\.added/);
  refuses(d => { const r = row(d, x => x.action === 'event.item.added'); d.activity = d.activity.filter(x => x !== r); }, /does not arrive exactly once|does not follow its event/);
  // The cover a stack shows without the change that made it the cover.
  refuses(d => { d.activity = d.activity.filter(x => !(x.action === 'items.update' && x.details.fields.includes('make_cover'))); }, /cover is neither|items\.update row/);
  // The 80% notice is written by the arrival that crosses the line, at that arrival's time.
  refuses(d => { const n = d.notifications.find(x => x.kind === 'storage.threshold'); const r = row(d, x => x.object_ids[0] === n.id); const t = '2026-06-09T16:36:00-07:00'; n.at = r.at = t; }, /notifications do not match|out of time order|does not follow/);
  // Something the account holder did in the middle of the night.
  refuses(d => { const r = row(d, x => x.action === 'items.update' && x.at.startsWith('2025-03')); r.at = r.at.slice(0, 11) + '03:10:00' + r.at.slice(19); }, /at 3 h local time/);
});

test('W1 acceptance on the reference library: search, versions, storage, bytes, exposure; controls', () => {
  const f = fixture({seed: 'reference'});
  const nov = f.call('fernshelf.items.search', {label_id: 'pl-dana', start: '2026-11-01', end: '2026-11-30'});
  assert.equal(nov.rows.length, 7);
  const covers = nov.rows.filter(r => r.is_cover);
  assert.deepEqual(covers.map(r => [r.id, r.stack_size]), [['it-2611-0942', 3], ['it-2611-0931', 3]]);
  assert.ok(!nov.rows.some(r => r.id === 'it-2610-0949'), 'taken 23:30 on 31 October local time, which is 1 November in UTC');
  const cover = f.call('fernshelf.items.get', {id: 'it-2611-0942'}).item;
  assert.deepEqual(cover.stack.versions.map(v => [v.id, v.is_cover]), [['it-2611-0940', false], ['it-2611-0941', false], ['it-2611-0942', true]]);
  assert.equal(cover.stack.kind, 'edit');
  const s = f.call('fernshelf.storage.summary').storage;
  assert.deepEqual([s.quota_bytes, s.used_bytes, s.trash_bytes, s.pending_bytes], [15 * GB, 13.95 * GB, 0.41 * GB, 0]);
  // duplicate_bytes by the rule, computed here independently from the records.
  const t = Date.parse(f.now), live = reference.items.filter(i => i.backed_up && i.state === 'active');
  const fromStacks = DUPLICATES.filter(id => live.some(i => i.id === id));
  const byHash = {};
  for (const i of live) (byHash[i.content_hash] = byHash[i.content_hash] || []).push(i);
  const fromHashes = Object.values(byHash).filter(g => g.length > 1).flatMap(g => g.sort((a, b) => Date.parse(a.added_at) - Date.parse(b.added_at)).slice(1).map(i => i.id));
  const bytes = ids => ids.reduce((n, id) => n + reference.items.find(i => i.id === id).declared_bytes, 0);
  assert.equal(fromStacks.length, 8);
  assert.equal(fromHashes.length, 6);
  assert.deepEqual([s.duplicate_bytes_from_stacks, s.duplicate_bytes_from_hashes, s.duplicate_bytes], [bytes(fromStacks), bytes(fromHashes), bytes([...new Set([...fromStacks, ...fromHashes])])]);
  const largest = live.filter(i => Date.parse(i.taken_at) < t).sort((a, b) => b.declared_bytes - a.declared_bytes).slice(0, 10).map(i => i.id);
  assert.deepEqual(s.largest_items.map(i => i.id), largest);
  assert.equal(s.largest_items[0].kind, 'video');
  // items.read returns the stored PNG whose SHA-256 is in the catalogue.
  const r = f.call('fernshelf.items.read', {id: 'it-2611-0931'});
  const entry = catalog.assets.find(a => a.asset_id === r.asset_id), png = Buffer.from(r.file.base64, 'base64');
  assert.deepEqual([r.file.mime_type, r.file.sha256, crypto.createHash('sha256').update(png).digest('hex'), png.length], ['image/png', entry.integrity.sha256, entry.integrity.sha256, entry.integrity.bytes]);
  assert.deepEqual(r.file.media, {image: {width: 128, height: 96}});
  assert.equal(f.call('fernshelf.items.read', {id: 'it-2611-0931', asset_id: 'img-it-2611-0931'}).asset_id, 'img-it-2611-0931');
  // exposure.get: Reunion 2026 with 4 joined members, link ln-0012, one view and one save by Kofi.
  const e = f.call('fernshelf.exposure.get', {id: 'it-2611-0931'});
  assert.deepEqual(e.albums.map(a => [a.album_id, a.visible_to.length, a.links.map(l => l.link_id)]), [['al-reunion-2026', 4, ['ln-0012']]]);
  assert.deepEqual([e.views.map(v => v.viewer.person_id), e.saves.map(v => v.viewer.person_id)], [['person-kofi'], ['person-kofi']]);
  // Controls.
  refused(f, 'fernshelf.items.get', {id: 'it-0000-0000'}, 'not_found');
  refused(f, 'fernshelf.items.read', {id: 'it-2611-0937'}, 'no_file');
  refused(f, 'fernshelf.items.read', {id: 'it-2611-0931', asset_id: 'img-it-2611-0934'}, 'not_found');
  refused(f, 'fernshelf.items.search', {start: '2026-11-30', end: '2026-11-01'}, 'invalid_window');
  const pastWithFile = reference.items.find(i => i.file && i.state === 'trashed' && Date.parse(i.purge_at) <= t);
  refused(f, 'fernshelf.items.read', {id: pastWithFile.id}, 'gone');
  const trashedWithFile = reference.items.find(i => i.file && i.state === 'trashed' && Date.parse(i.purge_at) > t);
  refused(f, 'fernshelf.items.read', {id: trashedWithFile.id}, 'in_trash');
});

test('W2 acceptance: an album of 12, a new label, make_cover on the original; controls', () => {
  const f = fixture({seed: 'reference'});
  const a = f.call('fernshelf.albums.create', {title: 'Autumn walks'});
  const twelve = f.call('fernshelf.items.search', {start: '2026-09-01', end: '2026-10-31', kind: 'photo', limit: 12}).rows.map(r => r.id);
  assert.equal(twelve.length, 12);
  assert.deepEqual(f.call('fernshelf.albums.update', {id: a.id, add_ids: twelve}).item_ids, twelve);
  assert.deepEqual(f.call('fernshelf.albums.get', {id: a.id}).album.entries.map(x => x.id), twelve);
  f.call('fernshelf.items.update', {id: 'it-2611-0943', patch: {add_people: ['pl-omar']}});
  assert.ok(f.call('fernshelf.items.search', {label_id: 'pl-omar'}).rows.some(x => x.id === 'it-2611-0943'));
  f.call('fernshelf.items.update', {id: 'it-2611-0940', patch: {make_cover: true}});
  const row = f.call('fernshelf.items.search', {label_id: 'pl-iris', start: '2026-11-14', end: '2026-11-14'}).rows;
  assert.deepEqual(row.map(x => [x.id, x.stack_id, x.is_cover]), [['it-2611-0940', 'st-0190', true]]);
  const trashed = reference.items.find(i => i.state === 'trashed' && Date.parse(i.purge_at) > Date.parse(f.now));
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: [trashed.id]}, 'in_trash');
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: [twelve[0]]}, 'already_in_album');
  const many = f.call('fernshelf.items.search', {kind: 'photo', limit: 51}).rows.map(x => x.id);
  refused(f, 'fernshelf.albums.update', {id: a.id, add_ids: many}, 'limit_exceeded');
  refused(f, 'fernshelf.items.update', {id: 'it-2611-0934', patch: {make_cover: true}}, 'not_stacked');
  refused(f, 'fernshelf.albums.delete', {id: 'al-reunion-2026'}, 'confirm_required');
  refused(f, 'fernshelf.albums.delete', {id: 'al-winter-visit'}, 'confirm_required', 'a private album with an active link is still shared');
});

test('W3 acceptance: members, contributions and saving, links; events that follow an album and link made in the run; controls', () => {
  const f = fixture({seed: 'reference'});
  assert.equal(f.call('fernshelf.albums.members.invite', {id: 'al-family-2026', person_id: 'person-dana', role: 'viewer'}).member_status, 'invited');
  f.event(ev('member.changed', '2026-11-20T09:10:00-08:00', {album_id: 'al-family-2026', person_id: 'person-dana', change: 'join'}));
  const shown = f.call('fernshelf.albums.get', {id: 'al-family-2026'}).album.entries.map(x => x.id);
  for (const id of shown) assert.ok(f.call('fernshelf.exposure.get', {id}).visible_to.includes('person-dana'), id);
  f.event(ev('contribution.changed', '2026-11-20T09:20:00-08:00', {album_id: 'al-reunion-2026', person_id: 'person-omar',
    add: [{item_id: 'ct-omar-0008', kind: 'photo', taken_at: '2026-11-14T17:06:00-08:00', people: ['pl-dana'], declared_bytes: 3920000}]}));
  const saved = f.call('fernshelf.albums.save_item', {id: 'al-reunion-2026', item_id: 'ct-omar-0008'});
  assert.deepEqual([saved.source, f.call('fernshelf.items.get', {id: saved.id}).item.source], ['saved_from_share', 'saved_from_share']);
  const link = f.call('fernshelf.links.create', {id: 'al-family-2026', expires_at: '2026-11-27T09:00:00-08:00'});
  assert.equal(link.state, 'active');
  f.event(ev('share.viewed', '2026-11-20T09:40:00-08:00', {view_id: 'vw-0500', surface: {type: 'link', id: link.id}, viewer: {person_id: 'person-lena'},
    viewed_item_ids: shown.slice(0, 2), saved_item_ids: shown.slice(0, 1)}));
  assert.equal(f.call('fernshelf.links.revoke', {id: link.id}).state, 'revoked');
  const ex = f.call('fernshelf.exposure.get', {id: shown[0]});
  assert.ok(ex.views.some(v => v.view_id === 'vw-0500') && ex.saves.some(v => v.view_id === 'vw-0500'), 'the view and the save are still listed');
  // An album made in the run, reached by events through album_match.
  const mine = f.call('fernshelf.albums.create', {title: 'For Dana'});
  f.call('fernshelf.albums.update', {id: mine.id, add_ids: ['it-2611-0931']});
  f.call('fernshelf.albums.members.invite', {id: mine.id, person_id: 'person-dana', role: 'viewer'});
  const ml = f.call('fernshelf.links.create', {id: mine.id});
  f.event(ev('member.changed', '2026-11-20T09:45:00-08:00', {album_match: {contains_item_ids: ['it-2611-0931']}, person_id: 'person-dana', change: 'join'}, 'ev-fs-412'));
  assert.equal(f.data.albums.find(x => x.id === mine.id).members[0].status, 'joined');
  assert.equal(f.data.activity.find(x => x.event_id === 'ev-fs-412').details.album_id, mine.id);
  f.event(ev('share.viewed', '2026-11-20T09:50:00-08:00', {view_id: 'vw-0501', surface: {type: 'link', album_match: {person_id: 'person-dana'}}, viewer: {anonymous: true}, viewed_item_ids: 'all'}));
  assert.deepEqual([f.data.views.at(-1).surface.link_id, f.data.views.at(-1).viewed_item_ids], [ml.id, ['it-2611-0931']]);
  // Controls.
  refused(f, 'fernshelf.albums.members.invite', {id: mine.id, person_id: 'person-dana', role: 'viewer'}, 'already_invited');
  refused(f, 'fernshelf.albums.members.update', {id: mine.id, person_id: 'person-kofi', role: 'contributor'}, 'not_member');
  refused(f, 'fernshelf.links.create', {id: mine.id, expires_at: '2026-11-19T09:00:00-08:00'}, 'invalid_window');
  rejected(f, ev('share.viewed', '2026-11-20T10:00:00-08:00', {view_id: 'vw-0502', surface: {type: 'link', id: link.id}, viewer: {anonymous: true}, viewed_item_ids: 'all'}));
  const other = f.call('fernshelf.albums.create', {title: 'Nobody invited'});
  f.call('fernshelf.albums.update', {id: other.id, add_ids: ['it-2611-0952']});
  rejected(f, ev('member.changed', '2026-11-20T10:00:00-08:00', {album_match: {contains_item_ids: ['it-2611-0952']}, person_id: 'person-sam', change: 'join'}));
  const week = f.call('fernshelf.links.create', {id: other.id, expires_at: '2026-11-27T09:00:00-08:00'});
  f.advance('2026-11-27T09:00:01-08:00');
  assert.equal(f.call('fernshelf.albums.get', {id: other.id}).album.links.find(l => l.id === week.id).state, 'expired');
  f.event(ev('contribution.changed', '2026-11-27T10:00:00-08:00', {album_id: 'al-reunion-2026', person_id: 'person-theo',
    add: [{item_id: 'ct-theo-0003', kind: 'photo', taken_at: '2026-11-14T18:20:00-08:00', declared_bytes: 1.2 * GB}]}));
  refused(f, 'fernshelf.albums.save_item', {id: 'al-reunion-2026', item_id: 'ct-theo-0003'}, 'over_quota');
});

test('W4 acceptance: Dana\'s request for three reunion photos, honour, what stays visible, the warning later; controls', () => {
  const f = fixture({seed: 'reference'});
  const albums = JSON.stringify(f.data.albums);
  f.event(require('../examples/scenario.json'));
  assert.equal(f.data.removals.find(r => r.id === 'rr-0007').state, 'pending');
  assert.equal(JSON.stringify(f.data.albums), albums);
  const ans = f.call('fernshelf.removals.respond', {id: 'rr-0007', decision: 'honor'});
  assert.deepEqual(ans.cleared.map(c => [c.item_id, c.album_ids]), [['it-2611-0931', ['al-reunion-2026']], ['it-2611-0934', ['al-reunion-2026']]]);
  assert.deepEqual(ans.not_removable, ['ct-omar-0007']);
  const seen = ans.already_seen.find(x => x.item_id === 'it-2611-0931');
  assert.deepEqual([seen.views.map(v => v.viewer.person_id + ' ' + v.at), seen.saves.map(v => v.viewer.person_id)], [['person-kofi 2026-11-15T20:14:00-08:00'], ['person-kofi']]);
  const holding = id => f.data.albums.filter(a => a.item_ids.includes(id)).map(a => a.id);
  assert.deepEqual([holding('it-2611-0931'), holding('it-2611-0934')], [['al-best-2026'], ['al-family-2026']], 'no other album changed');
  for (const id of ['it-2611-0931', 'it-2611-0934']) assert.equal(f.data.items.find(i => i.id === id).removal_history.at(-1).removal_id, 'rr-0007');
  const later = f.call('fernshelf.albums.update', {id: 'al-family-2026', add_ids: ['it-2611-0931']});
  assert.deepEqual(later.warnings.map(w => [w.code, w.item_id, w.person_id]), [['removal_honored', 'it-2611-0931', 'person-dana']]);
  // Controls.
  refused(f, 'fernshelf.removals.respond', {id: 'rr-0007', decision: 'honor'}, 'invalid_state');
  rejected(f, ev('removal.withdrawn', '2026-11-20T20:00:00-08:00', {removal_id: 'rr-0007'}));
  assert.deepEqual(f.call('fernshelf.albums.update', {id: 'al-family-2026', add_ids: ['it-2611-0935']}).warnings, [], 'rr-0005 is pending: no warning');
  const g = fixture({seed: 'reference'});
  g.event(ev('removal.requested', '2026-11-20T10:00:00-08:00', {removal_id: 'rr-0008', from_person_id: 'person-lena', item_ids: ['it-2611-0943'], scope: {type: 'everywhere'}}));
  const all = g.call('fernshelf.removals.respond', {id: 'rr-0008', decision: 'honor'});
  assert.deepEqual(all.cleared[0].album_ids, ['al-reunion-2026', 'al-family-2026']);
  assert.deepEqual(g.data.albums.filter(a => a.item_ids.includes('it-2611-0943')).map(a => a.id), [], 'it was only in shared albums');
  g.event(ev('removal.requested', '2026-11-20T10:05:00-08:00', {removal_id: 'rr-0009', from_person_id: 'person-lena', item_ids: ['it-2611-0942'], scope: {type: 'everywhere'}}));
  assert.deepEqual(g.call('fernshelf.removals.respond', {id: 'rr-0009', decision: 'honor'}).cleared[0].album_ids, [], 'Best of 2026 is shared with no one and is left alone');
  assert.ok(g.data.albums.find(a => a.id === 'al-best-2026').item_ids.includes('it-2611-0942'));
});

test('W5 acceptance: eight duplicates to the trash, restore, purge by the clock and now; a library at its quota; controls', () => {
  const f = fixture({seed: 'reference'});
  const used = f.call('fernshelf.storage.summary').storage.used_bytes;
  f.call('fernshelf.items.trash', {ids: DUPLICATES});
  for (const id of DUPLICATES) assert.deepEqual(f.call('fernshelf.exposure.get', {id}).albums, []);
  for (const a of f.call('fernshelf.albums.list').albums) assert.ok(!f.call('fernshelf.albums.get', {id: a.id}).album.entries.some(x => DUPLICATES.includes(x.id)));
  assert.equal(f.call('fernshelf.storage.summary').storage.used_bytes, used);
  f.call('fernshelf.items.restore', {ids: [inTwo]});
  assert.deepEqual(f.call('fernshelf.items.get', {id: inTwo}).item.albums.filter(a => a.shows_item).map(a => a.album_id).sort(), ['al-best-2026', 'al-family-2026']);
  const seven = DUPLICATES.filter(id => id !== inTwo), sevenBytes = seven.reduce((n, id) => n + reference.items.find(i => i.id === id).declared_bytes, 0);
  f.advance('2026-12-20T09:00:00-08:00');
  for (const id of seven) assert.equal(f.call('fernshelf.items.get', {id}).item.state, 'purged');
  const after = f.call('fernshelf.storage.summary').storage;
  const seedPurgedLater = reference.items.filter(i => i.state === 'trashed' && Date.parse(i.purge_at) > Date.parse('2026-11-20T09:00:00-08:00') && Date.parse(i.purge_at) <= Date.parse('2026-12-20T09:00:00-08:00'));
  assert.equal(after.used_bytes, used - sevenBytes - seedPurgedLater.reduce((n, i) => n + i.declared_bytes, 0));
  const withFile = seven.find(id => reference.items.find(i => i.id === id).file);
  refused(f, 'fernshelf.items.read', {id: withFile}, 'gone');
  refused(f, 'fernshelf.items.restore', {ids: [withFile]}, 'gone');
  assert.equal(f.call('fernshelf.items.search', {state: 'trashed'}).total, 0, 'everything trashed earlier is past its purge_at now');
  const two = f.call('fernshelf.items.search', {kind: 'photo', source: 'screenshot', collapse_stacks: false}).rows.slice(0, 2);
  f.call('fernshelf.items.trash', {ids: two.map(x => x.id)});
  const p = f.call('fernshelf.items.purge', {ids: two.map(x => x.id), confirm: true});
  assert.equal(p.freed_bytes, two.reduce((n, x) => n + x.declared_bytes, 0));
  assert.equal(f.call('fernshelf.storage.summary').storage.used_bytes, after.used_bytes - p.freed_bytes);
  // From the fixture again, with 1.05 GB free.
  const g = fixture({seed: 'reference'});
  g.event(ev('item.added', '2026-11-20T09:30:00-08:00', {item_id: 'it-2611-0970', kind: 'video', taken_at: '2026-11-20T08:00:00-08:00', source: 'camera',
    declared_bytes: 1.2 * GB, width: 3840, height: 2160, duration_ms: 1500000}));
  let s = g.call('fernshelf.storage.summary').storage;
  assert.deepEqual([s.used_bytes, s.pending_bytes], [13.95 * GB, 1.2 * GB]);
  assert.deepEqual(g.data.notifications.filter(n => n.kind === 'storage.threshold' && n.at === '2026-11-20T09:30:00-08:00').map(n => n.level), ['full']);
  assert.deepEqual(g.call('fernshelf.items.search', {backed_up: false}).rows.map(r => r.id), ['it-2611-0970']);
  assert.deepEqual(g.call('fernshelf.exposure.get', {id: 'it-2611-0970'}).albums, []);
  refused(g, 'fernshelf.albums.update', {id: 'al-best-2026', add_ids: ['it-2611-0970']}, 'not_backed_up');
  g.event(ev('backup.resumed', '2026-11-20T09:35:00-08:00', {}));
  assert.equal(g.data.items.find(i => i.id === 'it-2611-0970').backed_up, false, 'still does not fit');
  const bigTrash = reference.items.find(i => i.state === 'trashed' && i.declared_bytes === 0.3 * GB);
  assert.equal(g.call('fernshelf.items.purge', {ids: [bigTrash.id], confirm: true}).freed_bytes, 0.3 * GB);
  assert.equal(g.data.items.find(i => i.id === 'it-2611-0970').backed_up, false, 'freeing space changes no backed_up flag');
  g.event(ev('backup.resumed', '2026-11-20T09:40:00-08:00', {}));
  s = g.call('fernshelf.storage.summary').storage;
  assert.deepEqual([g.data.items.find(i => i.id === 'it-2611-0970').backed_up, s.used_bytes, s.pending_bytes], [true, 13.95 * GB - 0.3 * GB + 1.2 * GB, 0]);
  // Controls.
  refused(g, 'fernshelf.items.purge', {ids: [DUPLICATES[0]], confirm: true}, 'invalid_state');
  refused(g, 'fernshelf.items.trash', {ids: [DUPLICATES[0], 'ct-omar-0007']}, 'not_yours');
  assert.equal(g.data.items.find(i => i.id === DUPLICATES[0]).state, 'active');
  const trashedNow = reference.items.find(i => i.state === 'trashed' && Date.parse(i.purge_at) > Date.parse(g.now) && i.id !== bigTrash.id);
  refused(g, 'fernshelf.items.purge', {ids: [trashedNow.id]}, 'confirm_required');
  const burst = reference.stacks.find(x => x.kind === 'burst' && x.id !== 'st-0188');
  const res = g.call('fernshelf.items.trash', {ids: [burst.cover_id]});
  const newest = burst.item_ids.filter(id => id !== burst.cover_id).map(id => reference.items.find(i => i.id === id)).sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at))[0];
  assert.deepEqual(res.covers_changed, [{stack_id: burst.id, cover_id: newest.id}]);
});
