'use strict';
// T01-T16 of the approved plan, App-only. Core's own contracts over real MCP are in tests/mcp.integration.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const derive = require('../src/derive.cjs');
const {fixture} = require('./harness.cjs');
const seed = () => structuredClone(require('../fixtures/minimal.json'));
const binding = () => structuredClone(require('../fixtures/binding.json'));
const CLOCK = require('../fixtures/clock.json').initial_time;
const NOV23 = '2026-11-23T10:00:00-05:00';
const start = (options = {}) => { const f = fixture(options); f.advance(NOV23); return f; };
const ev = (event_id, at, operation, payload) => ({event_id, at, operation: 'ribbonwell.' + operation, payload});
// A refusal carries its code and leaves business data unchanged.
function refuses(f, fn, code) { const before = JSON.stringify(f.data); assert.throws(fn, e => e.code === code, 'expected ' + code); assert.equal(JSON.stringify(f.data), before, code + ' left data unchanged'); }
const rejects = (f, event) => refuses(f, () => f.event(event), 'invalid_event');
const item = (f, name, list) => f.data.items.find(i => i.name === name && (!list || i.list_id === list));
const TRAIN = f => item(f, 'Wooden train set').item_id;

test('T01 [W1] groups, members and lists; filters, pagination and not_found', () => {
  const f = fixture(), before = f.data;
  assert.deepEqual(f.call('groups.list').groups.map(g => [g.group_id, g.member_count]), [['grp-family', 9], ['grp-friends', 6]]);
  const family = f.call('groups.get', {id: 'grp-family'}).group;
  assert.deepEqual(family.members.filter(m => m.is_me).map(m => m.member_id), ['mem-priya']);
  assert.equal(f.call('lists.list').total, 15);
  assert.equal(f.call('lists.list', {group_id: 'grp-family'}).total, 9);
  assert.deepEqual(f.call('lists.list', {owner_member_id: 'mem-tomas'}).lists.map(l => l.list_id), ['lst-tomas-family', 'lst-tomas-friends']);
  assert.deepEqual(f.call('lists.list', {occasion_from: '2026-12-01T00:00:00-05:00', occasion_to: '2026-12-31T23:59:00-05:00'}).lists.map(l => l.list_id), ['lst-tomas-family']);
  const page = f.call('lists.list', {limit: 4, offset: 12});
  assert.equal(page.lists.length, 3); assert.equal(page.total, 15);
  assert.deepEqual(f.call('lists.list').lists.filter(l => l.view !== 'other').map(l => [l.list_id, l.view]), [['lst-leela-family', 'managed'], ['lst-priya-family', 'own'], ['lst-priya-friends', 'own']]);
  refuses(f, () => f.call('lists.list', {occasion_from: '2026-12-31T00:00:00-05:00', occasion_to: '2026-12-01T00:00:00-05:00'}), 'invalid_window');
  assert.throws(() => f.call('lists.get', {id: 'lst-nowhere'}), e => e.code === 'not_found' && /ribbonwell\.lists\.list/.test(e.message));
  refuses(f, () => f.call('groups.get', {id: 'grp-nowhere'}), 'not_found');
  assert.deepEqual(f.data, before);
  // A list in a group the member is not in is not_found, exactly like an unknown one.
  const s = seed();
  s.groups.push({group_id: 'grp-club', name: 'Book club', member_ids: ['mem-jo', 'mem-santi']});
  s.lists.push({list_id: 'lst-jo-club', owner_member_id: 'mem-jo', group_id: 'grp-club', managed_by: null, occasion_name: null, occasion_date: null, created_at: '2026-05-01T10:00:00-04:00'});
  const g = fixture({seed: s});
  refuses(g, () => g.call('lists.get', {id: 'lst-jo-club'}), 'not_found');
  refuses(g, () => g.call('groups.get', {id: 'grp-club'}), 'not_found');
  assert.equal(g.call('lists.list').total, 15);
});

test('T02 [W1] the three views of a list: own, managed and someone else\'s', () => {
  const f = start(), stored = f.data;
  assert.equal(stored.claims.filter(c => stored.items.find(i => i.item_id === c.item_id).list_id === 'lst-priya-family').length, 6);
  const own = f.call('lists.get', {id: 'lst-priya-family', include_removed: true});
  assert.equal(own.list.view, 'own');
  for (const i of own.items) { assert.equal(i.claims_hidden, true); for (const k of ['claims', 'remaining', 'over_claimed']) assert.ok(!(k in i), 'no ' + k + ' on an own-list item'); }
  const apron = item(f, 'Linen apron');
  assert.deepEqual(Object.keys(f.call('items.get', {id: apron.item_id}).item).filter(k => /claim|remaining/.test(k)), ['claims_hidden']);
  assert.ok(f.call('items.search', {query: 'apron'}).items.every(i => i.claims_hidden === true && !('claims' in i)));
  assert.ok(f.call('claims.list', {limit: 100}).claims.every(c => c.list_owner_member_id !== 'mem-priya'));
  assert.ok(!JSON.stringify(f.call('notifications.list', {limit: 100})).includes(apron.item_id));
  const managed = f.call('lists.get', {id: 'lst-leela-family'});
  assert.equal(managed.list.view, 'managed');
  const train = managed.items.find(i => i.name === 'Wooden train set');
  assert.equal(train.claims_hidden, false); assert.equal(train.remaining, 1); assert.equal(train.over_claimed, false);
  assert.deepEqual(train.claims.map(c => [c.member_id, c.status, c.quantity, c.mine]), [['mem-kamala', 'purchased', 1, false]]);
  const skillet = f.call('lists.get', {id: 'lst-tomas-family'}).items.find(i => i.name === 'Cast-iron skillet');
  assert.equal(skillet.quantity_wanted, 1); assert.equal(skillet.remaining, 0);
  assert.deepEqual(skillet.claims.map(c => [c.member_name, c.status]), [['Kamala Raman', 'reserved']]);
  // The owner (here the manager) may lower the wanted quantity below what is claimed: claims stay and shoppers see over_claimed.
  f.event(ev('t02-1', '2026-11-23T11:00:00-05:00', 'claim.recorded', {actor_member_id: 'mem-dev', item_id: train.item_id, status: 'reserved', quantity: 1}));
  f.call('items.update', {id: train.item_id, patch: {quantity_wanted: 1}});
  const lowered = f.call('items.get', {id: train.item_id}).item;
  assert.equal(lowered.over_claimed, true); assert.equal(lowered.remaining, 0); assert.equal(lowered.claims.length, 2);
});

test('T03 [W1] account with now, exchanges, giftee and notifications', () => {
  const f = fixture(), before = f.data;
  const account = f.call('account.get');
  assert.equal(account.now, CLOCK); assert.equal(account.account.member_id, 'mem-priya'); assert.equal(account.account.person_id, 'person-priya');
  assert.ok(!JSON.stringify(account).includes('salt'));
  const all = f.call('exchanges.list').exchanges;
  assert.deepEqual(all.map(x => [x.exchange_id, x.status]), [['exc-family-2025', 'past'], ['exc-friends-plants', 'expired'], ['exc-friends-potluck', 'drawn'], ['exc-family-cookies', 'open']]);
  const potluck = f.call('exchanges.get', {id: 'exc-friends-potluck'}).exchange;
  assert.deepEqual(potluck.my_giftee, {member_id: 'mem-noor', name: 'Noor Haddad'});
  assert.ok(!('assignments' in potluck)); assert.equal(potluck.exclusions, null); assert.equal(potluck.joined, true);
  assert.ok(!JSON.stringify(f.call('exchanges.list')).includes('"giver"'));
  assert.equal(f.call('exchanges.get', {id: 'exc-family-cookies'}).exchange.my_giftee, null);
  assert.deepEqual(f.call('exchanges.get', {id: 'exc-family-2025'}).exchange.exclusions, [['mem-priya', 'mem-tomas'], ['mem-kamala', 'mem-ravi']]);
  const notes = f.call('notifications.list', {limit: 100});
  assert.equal(notes.total, before.notifications.length);
  assert.equal(f.call('notifications.list', {since: '2026-11-12T00:00:00-05:00'}).notifications.every(n => Date.parse(n.at) >= Date.parse('2026-11-12T00:00:00-05:00')), true);
  refuses(f, () => f.call('exchanges.get', {id: 'exc-nowhere'}), 'not_found');
  assert.deepEqual(f.data, before);
});

test('T04 [W2] items.add, items.update and lists.update with their refusals', () => {
  const f = start(), rows = f.data.activity.length;
  const id = f.call('items.add', {id: 'lst-priya-family', item: {name: 'Trail running vest'}}).id;
  assert.equal(id, 'itm-r1');
  assert.deepEqual((({status, quantity_wanted, priority, variant, created_at}) => ({status, quantity_wanted, priority, variant, created_at}))(f.call('items.get', {id}).item),
    {status: 'listed', quantity_wanted: 1, priority: 'medium', variant: null, created_at: NOV23});
  f.call('items.update', {id, patch: {variant: 'size M'}});
  assert.equal(f.call('items.get', {id}).item.variant, 'size M');
  f.call('lists.update', {id: 'lst-priya-family', patch: {occasion_name: 'Fortieth birthday'}});
  assert.equal(f.call('lists.get', {id: 'lst-priya-family'}).list.occasion_name, 'Fortieth birthday');
  assert.equal(f.call('items.add', {id: 'lst-leela-family', item: {name: 'Paint smock', quantity_wanted: 2}}).id, 'itm-r2');
  assert.equal(f.data.activity.length, rows + 4);
  assert.deepEqual(f.data.activity.at(-3).replaced, {variant: null});
  refuses(f, () => f.call('items.add', {id: 'lst-priya-family', item: {name: ' trail RUNNING vest '}}), 'name_taken');
  refuses(f, () => f.call('items.update', {id: item(f, 'Linen apron').item_id, patch: {name: 'TRAIL running vest'}}), 'name_taken');
  refuses(f, () => f.call('items.add', {id: 'lst-tomas-family', item: {name: 'Anything'}}), 'not_list_editor');
  refuses(f, () => f.call('items.update', {id: 'itm-tomas-014', patch: {note: 'x'}}), 'not_list_editor');
  refuses(f, () => f.call('lists.update', {id: 'lst-tomas-family', patch: {occasion_name: 'x'}}), 'not_list_editor');
  for (const q of [0, 21]) refuses(f, () => f.call('items.add', {id: 'lst-priya-family', item: {name: 'Bulk thing', quantity_wanted: q}}), 'invalid_quantity');
  refuses(f, () => f.call('items.update', {id, patch: {quantity_wanted: 0}}), 'invalid_quantity');
  refuses(f, () => f.call('items.update', {id, patch: {}}), 'invalid_arguments');
  refuses(f, () => f.call('items.get', {id: 'itm-nowhere'}), 'not_found');
});

test('T05 [W2] remove and restore keep claims; a removed name is free; quantity can drop below what is claimed', () => {
  const f = start(), train = TRAIN(f);
  f.call('items.remove', {id: train});
  assert.equal(f.data.claims.find(c => c.item_id === train).status, 'purchased');
  assert.deepEqual(f.data.claims.find(c => c.item_id === train).changed_fields, ['removed']);
  assert.ok(!f.call('lists.get', {id: 'lst-leela-family'}).items.some(i => i.item_id === train));
  assert.equal(f.call('lists.get', {id: 'lst-leela-family', include_removed: true}).items.find(i => i.item_id === train).status, 'removed');
  refuses(f, () => f.call('items.remove', {id: train}), 'invalid_state');
  refuses(f, () => f.call('items.update', {id: train, patch: {note: 'x'}}), 'invalid_state');
  const twin = f.call('items.add', {id: 'lst-leela-family', item: {name: 'Wooden train set'}}).id;
  refuses(f, () => f.call('items.restore', {id: train}), 'name_taken');
  f.call('items.update', {id: twin, patch: {name: 'Wooden train set, small'}});
  f.call('items.restore', {id: train});
  const back = f.call('items.get', {id: train}).item;
  assert.equal(back.status, 'listed'); assert.equal(back.remaining, 1); assert.deepEqual(f.data.claims.find(c => c.item_id === train).changed_fields, []);
  refuses(f, () => f.call('items.restore', {id: train}), 'invalid_state');
  // A claim of the bound member on an item its owner removed can still be read and released.
  f.event(ev('t05-1', '2026-11-23T12:00:00-05:00', 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-014', removed: true}));
  const mine = f.call('claims.list', {limit: 100}).claims.find(c => c.item_id === 'itm-tomas-014');
  assert.equal(mine.item_removed, true); assert.deepEqual(mine.changed_fields, ['removed']);
  refuses(f, () => f.call('claims.reserve', {id: item(f, 'Cast-iron skillet').item_id}), 'insufficient_quantity');
  f.call('claims.release', {id: mine.claim_id});
  assert.equal(f.call('claims.list', {status: 'released', limit: 100}).claims.some(c => c.claim_id === mine.claim_id), true);
});

test('T06 [W2] owner blindness: own-list writes return the same with and without claims', () => {
  const bare = seed();
  const ownItems = new Set(bare.items.filter(i => i.list_id === 'lst-priya-family').map(i => i.item_id));
  bare.claims = bare.claims.filter(c => !ownItems.has(c.item_id));
  const a = start(), b = start({seed: bare}), apron = item(a, 'Linen apron').item_id;
  assert.equal(a.data.claims.filter(c => c.item_id === apron).length, 1); assert.equal(b.data.claims.filter(c => c.item_id === apron).length, 0);
  const steps = [['items.get', {id: apron}], ['lists.get', {id: 'lst-priya-family', include_removed: true}], ['items.search', {query: 'linen'}], ['items.update', {id: apron, patch: {variant: 'navy', quantity_wanted: 1}}],
    ['items.remove', {id: apron}], ['items.remove', {id: apron}], ['items.update', {id: apron, patch: {note: 'x'}}], ['items.restore', {id: apron}], ['items.restore', {id: apron}],
    ['lists.update', {id: 'lst-priya-family', patch: {occasion_date: null}}], ['claims.reserve', {id: apron}], ['claims.list', {limit: 100}], ['notifications.list', {limit: 100}]];
  for (const [name, args] of steps) {
    const run = f => { try { return {result: f.call(name, args)}; } catch (e) { return {code: e.code, message: e.message}; } };
    assert.deepEqual(run(a), run(b), name + ' is the same with and without claims');
  }
  // The claim count exists only in the activity row, which no Agent read returns.
  const removal = f => f.data.activity.find(r => r.action === 'items.remove' && r.object_id === apron && r.request_id.startsWith('local-')).unreleased_claims;
  assert.equal(removal(a), 1); assert.equal(removal(b), 0);
  // A claim recorded on the bound member's own list writes no notification and stays invisible.
  const notes = a.data.notifications.length;
  a.event(ev('t06-1', '2026-11-23T13:00:00-05:00', 'claim.recorded', {actor_member_id: 'mem-tomas', item_match: {list_id: 'lst-priya-family', name: 'Linen apron'}, status: 'released'}));
  const other = a.data.items.find(i => i.list_id === 'lst-priya-family' && i.status === 'listed' && !a.data.claims.some(c => c.item_id === i.item_id && c.status !== 'released'));
  a.event(ev('t06-2', '2026-11-23T13:05:00-05:00', 'claim.recorded', {actor_member_id: 'mem-anika', item_id: other.item_id, status: 'purchased'}));
  assert.equal(a.data.notifications.length, notes);
  assert.equal(a.call('items.get', {id: other.item_id}).item.claims_hidden, true);
});

test('T07 [W3] claims.reserve and its refusals, including a managed list', () => {
  const f = start(), train = TRAIN(f);
  refuses(f, () => f.call('claims.reserve', {id: train, quantity: 2}), 'insufficient_quantity');
  refuses(f, () => f.call('claims.reserve', {id: item(f, 'Linen apron').item_id}), 'own_list');
  const removed = f.data.items.find(i => i.status === 'removed' && !['lst-priya-family', 'lst-priya-friends'].includes(i.list_id));
  refuses(f, () => f.call('claims.reserve', {id: removed.item_id}), 'removed_item');
  for (const q of [0, 21]) refuses(f, () => f.call('claims.reserve', {id: train, quantity: q}), 'invalid_quantity');
  const made = f.call('claims.reserve', {id: train, quantity: 1, note: 'Ask Kamala which track she bought.'});
  assert.equal(made.id, 'clm-r1'); assert.equal(made.reserved_until, '2026-12-07T10:00:00-05:00');
  assert.equal(f.call('items.get', {id: train}).item.remaining, 0);
  refuses(f, () => f.call('claims.reserve', {id: train}), 'already_claimed');
  refuses(f, () => f.call('claims.reserve', {id: 'itm-tomas-014'}), 'already_claimed');
  refuses(f, () => f.call('claims.reserve', {id: 'itm-nowhere'}), 'not_found');
  const row = f.data.activity.at(-1);
  assert.deepEqual([row.actor, row.action, row.object_id, row.list_id, row.request_id], ['agent', 'claims.reserve', 'clm-r1', 'lst-leela-family', row.request_id]);
});

test('T08 [W3] claims.update, claims.release and a new claim after a release', () => {
  const f = start(), mugs = f.data.items.find(i => i.status === 'listed' && i.quantity_wanted >= 3 && !['mem-priya'].includes(f.data.lists.find(l => l.list_id === i.list_id).owner_member_id)
    && !f.data.claims.some(c => c.item_id === i.item_id && c.status !== 'released'));
  const id = f.call('claims.reserve', {id: mugs.item_id}).id, read = () => f.call('claims.list', {limit: 100}).claims.find(c => c.claim_id === id);
  f.call('claims.update', {id, patch: {quantity: 3}}); assert.equal(read().quantity, 3);
  refuses(f, () => f.call('claims.update', {id, patch: {quantity: mugs.quantity_wanted + 1}}), 'insufficient_quantity');
  refuses(f, () => f.call('claims.update', {id, patch: {quantity: 0}}), 'invalid_quantity');
  f.call('claims.update', {id, patch: {quantity: 1, note: 'Blue if they have it.'}}); assert.equal(read().note, 'Blue if they have it.');
  f.call('claims.update', {id, patch: {status: 'purchased'}});
  assert.deepEqual([read().status, read().reserved_until], ['purchased', null]);
  refuses(f, () => f.call('claims.update', {id, patch: {reserved_until: '2026-11-30T10:00:00-05:00'}}), 'invalid_state');
  f.advance('2026-11-25T09:00:00-05:00');
  f.call('claims.update', {id, patch: {status: 'reserved'}});
  assert.deepEqual([read().status, read().reserved_until], ['reserved', '2026-12-09T09:00:00-05:00']);
  f.call('claims.update', {id, patch: {reserved_until: '2026-12-09T08:59:00-05:00'}}); assert.equal(read().reserved_until, '2026-12-09T08:59:00-05:00');
  refuses(f, () => f.call('claims.update', {id, patch: {reserved_until: '2026-12-15T09:00:00-05:00'}}), 'invalid_window');
  refuses(f, () => f.call('claims.update', {id, patch: {reserved_until: '2026-12-09T09:00:01-05:00'}}), 'invalid_window');
  refuses(f, () => f.call('claims.update', {id, patch: {reserved_until: '2026-11-25T09:00:00-05:00'}}), 'invalid_window');
  refuses(f, () => f.call('claims.update', {id, patch: {}}), 'invalid_arguments');
  f.call('claims.release', {id}); assert.equal(read().status, 'released');
  refuses(f, () => f.call('claims.update', {id, patch: {note: 'x'}}), 'invalid_state');
  refuses(f, () => f.call('claims.release', {id}), 'invalid_state');
  refuses(f, () => f.call('claims.update', {id: f.data.claims.find(c => c.member_id === 'mem-kamala').claim_id, patch: {note: 'x'}}), 'not_found');
  const again = f.call('claims.reserve', {id: mugs.item_id}).id;
  assert.notEqual(again, id); assert.equal(f.data.claims.filter(c => c.item_id === mugs.item_id && c.member_id === 'mem-priya').length, 2);
});

test('T09 [W3] a hold lapses at exactly reserved_until and frees its quantity', () => {
  const f = start(), train = TRAIN(f), rows = () => f.data.activity.length;
  const id = f.call('claims.reserve', {id: train, quantity: 1}).id, mine = () => f.call('claims.list', {limit: 100}).claims.find(c => c.claim_id === id);
  const stored = JSON.stringify(f.data), written = rows();
  f.advance('2026-12-07T09:59:59-05:00');
  assert.equal(mine().status, 'reserved'); assert.equal(f.call('items.get', {id: train}).item.remaining, 0);
  f.advance('2026-12-07T10:00:00-05:00');
  assert.equal(mine().status, 'lapsed'); assert.equal(f.call('items.get', {id: train}).item.remaining, 1);
  f.advance('2026-12-08T12:00:00-05:00');
  // Time alone rewrites nothing and writes no activity row or notification.
  assert.equal(JSON.stringify(f.data), stored); assert.equal(rows(), written);
  f.event(ev('ev-rw-310', '2026-12-08T12:05:00-05:00', 'claim.recorded', {actor_member_id: 'mem-dev', item_match: {list_id: 'lst-leela-family', name: 'Wooden train set'}, quantity: 1, status: 'reserved'}));
  assert.equal(f.call('items.get', {id: train}).item.remaining, 0);
  refuses(f, () => f.call('claims.update', {id, patch: {status: 'purchased'}}), 'insufficient_quantity');
  refuses(f, () => f.call('claims.update', {id, patch: {reserved_until: '2026-12-15T10:00:00-05:00'}}), 'insufficient_quantity');
  refuses(f, () => f.call('claims.update', {id, patch: {status: 'reserved'}}), 'insufficient_quantity');
  f.call('claims.update', {id, patch: {note: 'Dev has it now.'}}); assert.equal(mine().status, 'lapsed');
  // The same rule applies to a reservation made by an event: it lapses 14 days after the event.
  f.advance('2026-12-22T12:04:59-05:00'); assert.equal(f.call('items.get', {id: train}).item.remaining, 0);
  f.advance('2026-12-22T12:05:00-05:00');
  const view = f.call('items.get', {id: train}).item;
  assert.equal(view.remaining, 1); assert.deepEqual(view.claims.map(c => c.status).sort(), ['lapsed', 'lapsed', 'purchased']);
  f.call('claims.update', {id, patch: {status: 'purchased'}});
  assert.equal(mine().status, 'purchased'); assert.equal(f.call('items.get', {id: train}).item.remaining, 0);
  rejects(f, ev('t09-2', '2026-12-22T13:00:00-05:00', 'claim.recorded', {actor_member_id: 'mem-dev', item_id: train, status: 'purchased'}));
});

test('T10 [W3] material and other changes by the owner, removal and restore of a claimed item', () => {
  const f = start(), id = f.data.claims.find(c => c.item_id === 'itm-tomas-014').claim_id, notes = () => f.data.notifications.length, n0 = notes();
  const mine = () => f.call('claims.list', {limit: 100}).claims.find(c => c.claim_id === id);
  f.event(ev('ev-rw-302', '2026-12-02T08:40:00-05:00', 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-014', patch: {variant: 'size L'}}));
  assert.deepEqual(mine().changed_fields, ['variant']); assert.equal(notes(), n0 + 1);
  const note = f.data.notifications.at(-1);
  assert.deepEqual([note.kind, note.item_id, note.claim_id, note.actor_member_id], ['claim.item_changed', 'itm-tomas-014', id, 'mem-tomas']);
  f.event(ev('t10-2', '2026-12-02T09:00:00-05:00', 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-014', patch: {note: 'Any colour.', priority: 'high', quantity_wanted: 2}}));
  assert.deepEqual(mine().changed_fields, ['variant']); assert.equal(notes(), n0 + 1);
  f.event(ev('t10-3', '2026-12-02T09:10:00-05:00', 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-014', patch: {price_cents: 13900, store: 'Larkspur Outfitters'}}));
  assert.deepEqual(mine().changed_fields, ['variant', 'price_cents']); assert.equal(notes(), n0 + 2);
  f.call('claims.update', {id, patch: {note: 'Size L now.'}});
  assert.deepEqual(mine().changed_fields, []); assert.equal(notes(), n0 + 2);
  f.event(ev('t10-4', '2026-12-02T10:00:00-05:00', 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-014', removed: true}));
  assert.deepEqual([mine().changed_fields, mine().item_removed], [['removed'], true]); assert.equal(notes(), n0 + 3);
  f.event(ev('t10-5', '2026-12-02T11:00:00-05:00', 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-014', removed: false}));
  assert.deepEqual([mine().changed_fields, mine().item_removed], [[], false]); assert.equal(notes(), n0 + 3);
  // A change to an item the bound member has not claimed notifies nobody.
  f.event(ev('t10-6', '2026-12-02T12:00:00-05:00', 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-006', patch: {variant: '30 cm'}}));
  assert.equal(notes(), n0 + 3);
  assert.deepEqual(f.data.claims.find(c => c.item_id === 'itm-tomas-006').changed_fields, ['variant']);
});

const draw = (overrides = {}) => ({name: 'Raman family draw', budget_cents: 4000, join_by: '2026-11-30T23:59:00-05:00', exchange_date: '2026-12-24T18:00:00-05:00', exclusions: [['mem-priya', 'mem-tomas']], ...overrides});
const joins = (f, exchange, people, from = '2026-11-23T11:00:00-05:00') => people.forEach((p, i) =>
  f.event(ev('join-' + exchange.replace(/[^A-Za-z0-9]/g, '') + '-' + p, new Date(Date.parse(from) + i * 60000).toISOString().replace('.000Z', 'Z'), 'exchange.member_changed', {actor_member_id: 'mem-' + p, exchange_match: {group_id: 'grp-family', name: exchange}, change: 'joined'})));

test('T11 [W4] exchanges.create and exchanges.update', () => {
  const f = start();
  const id = f.call('exchanges.create', {id: 'grp-family', exchange: draw()}).id;
  assert.equal(id, 'exc-r1');
  const made = f.call('exchanges.get', {id}).exchange;
  assert.deepEqual([made.status, made.is_organizer, made.joined, made.participants.length, made.draw_ready, made.draw_blockers], ['open', true, false, 0, false, ['too_few_participants']]);
  refuses(f, () => f.call('exchanges.create', {id: 'grp-family', exchange: draw({name: ' raman FAMILY draw'})}), 'name_taken');
  refuses(f, () => f.call('exchanges.create', {id: 'grp-family', exchange: draw({name: 'B', join_by: '2026-12-24T18:00:00-05:00'})}), 'invalid_window');
  refuses(f, () => f.call('exchanges.create', {id: 'grp-family', exchange: draw({name: 'C', exclusions: [['mem-priya', 'mem-jo']]})}), 'invalid_exclusion');
  refuses(f, () => f.call('exchanges.create', {id: 'grp-family', exchange: draw({name: 'D', exclusions: [['mem-dev', 'mem-dev']]})}), 'invalid_exclusion');
  refuses(f, () => f.call('exchanges.create', {id: 'grp-nowhere', exchange: draw({name: 'E'})}), 'not_found');
  assert.equal(f.call('exchanges.create', {id: 'grp-friends', exchange: draw({exclusions: []})}).id, 'exc-r2');   // the same name in another group is fine
  f.call('exchanges.update', {id, patch: {budget_cents: 4500, exclusions: [['mem-tomas', 'mem-priya'], ['mem-priya', 'mem-tomas'], ['mem-kamala', 'mem-ravi']]}});
  assert.deepEqual(f.call('exchanges.get', {id}).exchange.exclusions, [['mem-priya', 'mem-tomas'], ['mem-kamala', 'mem-ravi']]);
  refuses(f, () => f.call('exchanges.update', {id, patch: {name: 'Cousins\' cookie tin exchange'}}), 'name_taken');
  refuses(f, () => f.call('exchanges.update', {id, patch: {exchange_date: '2026-11-30T23:59:00-05:00'}}), 'invalid_window');
  refuses(f, () => f.call('exchanges.update', {id, patch: {exclusions: [['mem-priya', 'mem-wen']]}}), 'invalid_exclusion');
  refuses(f, () => f.call('exchanges.update', {id: 'exc-family-cookies', patch: {budget_cents: 1}}), 'not_organizer');
  refuses(f, () => f.call('exchanges.update', {id: 'exc-family-2025', patch: {budget_cents: 1}}), 'invalid_state');
  // Moving join_by after the current time reopens joining.
  f.advance('2026-12-01T08:00:00-05:00');
  assert.equal(f.call('exchanges.get', {id}).exchange.status, 'closed');
  refuses(f, () => f.call('exchanges.join', {id}), 'joining_closed');
  f.call('exchanges.update', {id, patch: {join_by: '2026-12-05T23:59:00-05:00'}});
  assert.equal(f.call('exchanges.get', {id}).exchange.status, 'open');
  f.call('exchanges.join', {id}); assert.equal(f.call('exchanges.get', {id}).exchange.joined, true);
});

test('T12 [W4] join and leave by tool and by event in each status', () => {
  const f = start(), id = f.call('exchanges.create', {id: 'grp-family', exchange: draw()}).id, n0 = f.data.notifications.length;
  refuses(f, () => f.call('exchanges.leave', {id}), 'not_participant');
  f.call('exchanges.join', {id});
  refuses(f, () => f.call('exchanges.join', {id}), 'already_joined');
  joins(f, 'Raman family draw', ['kamala', 'dev', 'meera', 'ravi']);
  assert.equal(f.call('exchanges.get', {id}).exchange.participants.length, 5);
  assert.equal(f.data.notifications.length, n0 + 4);               // the bound member organizes it and the setting is on
  assert.equal(f.data.notifications.at(-1).kind, 'exchange.member_changed');
  rejects(f, ev('t12-a', '2026-11-23T12:00:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-dev', exchange_id: id, change: 'joined'}));        // already joined
  rejects(f, ev('t12-b', '2026-11-23T12:00:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-anika', exchange_id: id, change: 'left'}));         // not a participant
  rejects(f, ev('t12-c', '2026-11-23T12:00:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-jo', exchange_id: id, change: 'joined'}));          // outside the group
  rejects(f, ev('t12-d', '2026-11-23T12:00:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-priya', exchange_id: id, change: 'left'}));         // the bound member acts through tools
  f.event(ev('t12-e', '2026-11-23T12:10:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-ravi', exchange_id: id, change: 'left'}));
  f.call('exchanges.leave', {id}); f.call('exchanges.join', {id});
  // A full exchange: ten participants at most (a friends' and family seed of twelve in one group).
  const s = seed(); s.groups[0].member_ids = [...s.groups[0].member_ids, 'mem-jo', 'mem-santi', 'mem-noor'];
  const g = start({seed: s}), full = g.call('exchanges.create', {id: 'grp-family', exchange: draw()}).id;
  ['tomas', 'kamala', 'dev', 'meera', 'ravi', 'anika', 'jo', 'santi', 'noor', 'leela'].forEach((p, i) => g.event(ev('full-' + p, '2026-11-23T11:0' + i + ':00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-' + p, exchange_id: full, change: 'joined'})));
  refuses(g, () => g.call('exchanges.join', {id: full}), 'exchange_full');
  rejects(g, ev('full-x', '2026-11-23T11:30:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-arun', exchange_id: full, change: 'joined'}));
  // Closed: no joining, leaving still allowed. Drawn, past and expired: neither.
  f.advance('2026-12-01T00:00:00-05:00');
  assert.equal(f.call('exchanges.get', {id}).exchange.status, 'closed');
  refuses(f, () => f.call('exchanges.join', {id}), 'joining_closed');
  rejects(f, ev('t12-f', '2026-12-01T00:05:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-anika', exchange_id: id, change: 'joined'}));
  f.event(ev('t12-g', '2026-12-01T00:06:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-meera', exchange_id: id, change: 'left'}));
  f.call('exchanges.leave', {id});
  refuses(f, () => f.call('exchanges.join', {id: 'exc-friends-potluck'}), 'joining_closed');
  refuses(f, () => f.call('exchanges.leave', {id: 'exc-friends-potluck'}), 'invalid_state');
  refuses(f, () => f.call('exchanges.leave', {id: 'exc-family-2025'}), 'invalid_state');
  refuses(f, () => f.call('exchanges.join', {id: 'exc-friends-plants'}), 'joining_closed');
  rejects(f, ev('t12-h', '2026-12-01T00:10:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-noor', exchange_id: 'exc-friends-plants', change: 'left'}));
});

test('T13 [W4] the draw: every valid assignment is searched, in a fixed order', () => {
  const run = () => { const f = start(), id = f.call('exchanges.create', {id: 'grp-family', exchange: draw()}).id; f.call('exchanges.join', {id}); joins(f, 'Raman family draw', ['tomas', 'kamala', 'dev', 'meera']); return {f, id}; };
  const {f, id} = run(), n0 = f.data.notifications.length;
  assert.equal(f.call('exchanges.get', {id}).exchange.draw_ready, true);
  const result = f.call('exchanges.draw', {id});
  assert.ok(['mem-kamala', 'mem-dev', 'mem-meera'].includes(result.my_giftee.member_id), 'never the excluded partner, never herself');
  const stored = f.data.exchanges.find(x => x.exchange_id === id);
  assert.ok(derive.validAssignments(stored, stored.assignments)); assert.equal(stored.drawn_at, f.ctx.virtual_now);
  assert.ok(!stored.assignments.some(a => a.giver === 'mem-tomas' && a.receiver === 'mem-priya'), 'an exclusion blocks both directions');
  assert.deepEqual(f.call('exchanges.get', {id}).exchange.my_giftee, result.my_giftee);
  assert.equal(f.data.notifications.length, n0, 'the Agent\'s own draw writes no notification');
  const second = run(); assert.deepEqual(second.f.call('exchanges.draw', {id: second.id}), result);          // same seed and inputs, same result
  assert.deepEqual(second.f.data.exchanges.at(-1).assignments, stored.assignments);
  for (const [name, args] of [['exchanges.draw', {id}], ['exchanges.update', {id, patch: {budget_cents: 1}}], ['exchanges.leave', {id}]]) refuses(f, () => f.call(name, args), 'invalid_state');
  refuses(f, () => f.call('exchanges.join', {id}), 'joining_closed');
  // Too few participants, and exclusions that leave no valid assignment.
  const g = start(), small = g.call('exchanges.create', {id: 'grp-family', exchange: draw({exclusions: [['mem-priya', 'mem-kamala']]})}).id;
  g.call('exchanges.join', {id: small}); joins(g, 'Raman family draw', ['kamala']);
  refuses(g, () => g.call('exchanges.draw', {id: small}), 'too_few_participants');
  joins(g, 'Raman family draw', ['dev'], '2026-11-23T11:30:00-05:00');
  assert.deepEqual(g.call('exchanges.get', {id: small}).exchange.draw_blockers, ['no_valid_draw']);
  refuses(g, () => g.call('exchanges.draw', {id: small}), 'no_valid_draw');
  refuses(g, () => g.call('exchanges.draw', {id: 'exc-family-cookies'}), 'not_organizer');
  // The reviewer's example: with five participants where Anika may only exchange with Priya, the only valid
  // assignments pair those two and put the other three in a ring. A single-ring search would wrongly refuse.
  const h = start(), five = h.call('exchanges.create', {id: 'grp-family', exchange: draw({exclusions: [['mem-anika', 'mem-kamala'], ['mem-anika', 'mem-dev'], ['mem-anika', 'mem-meera']]})}).id;
  h.call('exchanges.join', {id: five}); joins(h, 'Raman family draw', ['anika', 'kamala', 'dev', 'meera']);
  assert.deepEqual(h.call('exchanges.draw', {id: five}).my_giftee, {member_id: 'mem-anika', name: 'Anika Raman'});
  const pairs = Object.fromEntries(h.data.exchanges.at(-1).assignments.map(a => [a.giver, a.receiver]));
  assert.equal(pairs['mem-anika'], 'mem-priya');
  assert.deepEqual([pairs['mem-kamala'], pairs['mem-dev'], pairs['mem-meera']].sort(), ['mem-dev', 'mem-kamala', 'mem-meera']);
  // exchange.drawn for someone else's exchange is validated by the same rule.
  const k = start();
  k.call('exchanges.join', {id: 'exc-family-cookies'});
  joins(k, 'Cousins\' cookie tin exchange', ['kamala', 'dev']);          // Meera (organizer) and Anika are already in
  const set = pairs => pairs.map(([giver, receiver]) => ({giver: 'mem-' + giver, receiver: 'mem-' + receiver}));
  const drawn = (event_id, at, assignments) => ev(event_id, at, 'exchange.drawn', {exchange_id: 'exc-family-cookies', assignments});
  rejects(k, drawn('d1', '2026-11-24T09:00:00-05:00', set([['meera', 'anika'], ['anika', 'meera'], ['priya', 'kamala'], ['kamala', 'dev']])));                       // Dev gives to nobody
  rejects(k, drawn('d2', '2026-11-24T09:00:00-05:00', set([['meera', 'meera'], ['anika', 'priya'], ['priya', 'kamala'], ['kamala', 'dev'], ['dev', 'anika']])));  // gives to herself
  rejects(k, drawn('d3', '2026-11-24T09:00:00-05:00', set([['meera', 'anika'], ['anika', 'priya'], ['priya', 'kamala'], ['kamala', 'dev'], ['dev', 'tomas']])));  // not a participant
  rejects(k, ev('d4', '2026-11-24T09:00:00-05:00', 'exchange.drawn', {exchange_id: 'exc-family-2025', assignments: []}));                                          // already drawn; and hers
  const before = k.data.notifications.length;
  k.event(drawn('d5', '2026-11-24T09:00:00-05:00', set([['meera', 'anika'], ['anika', 'meera'], ['priya', 'kamala'], ['kamala', 'dev'], ['dev', 'priya']])));      // two rings: valid
  assert.deepEqual(k.call('exchanges.get', {id: 'exc-family-cookies'}).exchange.my_giftee, {member_id: 'mem-kamala', name: 'Kamala Raman'});
  assert.deepEqual([k.data.notifications.length, k.data.notifications.at(-1).kind], [before + 1, 'exchange.drawn']);
});

test('T14 [W4] status at each boundary, exchange tags, not_my_giftee and over_budget', () => {
  const f = start(), status = id => f.call('exchanges.get', {id}).exchange.status, n0 = f.data.notifications.length;
  f.event(ev('ev-rw-320', '2026-11-25T10:00:00-05:00', 'exchange.opened', {actor_member_id: 'mem-jo', exchange: {exchange_id: 'exc-friends-2026', group_id: 'grp-friends', name: 'Book swap', budget_cents: 2500,
    join_by: '2026-12-05T23:59:00-05:00', exchange_date: '2026-12-19T18:00:00-05:00', exclusions: []}}));
  assert.deepEqual([f.data.notifications.length, f.data.notifications.at(-1).kind], [n0 + 1, 'exchange.invited']);
  assert.deepEqual(f.call('exchanges.get', {id: 'exc-friends-2026'}).exchange.participants, [{member_id: 'mem-jo', name: 'Jo Okafor'}]);
  f.call('exchanges.join', {id: 'exc-friends-2026'});
  f.event(ev('t14-2', '2026-11-26T07:30:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-santi', exchange_match: {group_id: 'grp-friends', name: 'book swap'}, change: 'joined'}));
  assert.equal(f.data.notifications.length, n0 + 1, 'someone else organizes it: no member_changed notification');
  const grinder = 'itm-santi-007';
  refuses(f, () => f.call('claims.reserve', {id: grinder, for_exchange_id: 'exc-friends-2026'}), 'not_my_giftee');     // not drawn yet
  f.advance('2026-12-05T23:58:59-05:00'); assert.equal(status('exc-friends-2026'), 'open');
  f.advance('2026-12-05T23:59:00-05:00'); assert.equal(status('exc-friends-2026'), 'closed');
  f.event(ev('ev-rw-330', '2026-12-06T09:00:00-05:00', 'exchange.drawn', {exchange_id: 'exc-friends-2026', assignments: [{giver: 'mem-jo', receiver: 'mem-priya'}, {giver: 'mem-priya', receiver: 'mem-santi'}, {giver: 'mem-santi', receiver: 'mem-jo'}]}));
  assert.equal(status('exc-friends-2026'), 'drawn');
  assert.deepEqual(f.call('exchanges.get', {id: 'exc-friends-2026'}).exchange.my_giftee, {member_id: 'mem-santi', name: 'Santi Morales'});
  assert.equal(f.data.notifications.at(-1).kind, 'exchange.drawn');
  const id = f.call('claims.reserve', {id: grinder, for_exchange_id: 'exc-friends-2026'}).id, mine = () => f.call('claims.list', {limit: 100}).claims.find(c => c.claim_id === id);
  assert.deepEqual([mine().for_exchange_id, mine().over_budget], ['exc-friends-2026', true]);                          // 8900 against a budget of 2500
  const cheap = f.data.items.find(i => i.list_id === 'lst-santi-friends' && i.status === 'listed' && i.price_cents !== null && i.price_cents <= 2500 && !f.data.claims.some(c => c.item_id === i.item_id && c.status !== 'released'));
  const second = f.call('claims.reserve', {id: cheap.item_id, for_exchange_id: 'exc-friends-2026'}).id;
  assert.equal(f.call('claims.list', {limit: 100}).claims.find(c => c.claim_id === second).over_budget, false);
  const jos = f.data.items.find(i => i.list_id === 'lst-jo-friends' && i.status === 'listed' && !f.data.claims.some(c => c.item_id === i.item_id && c.status !== 'released'));
  refuses(f, () => f.call('claims.reserve', {id: jos.item_id, for_exchange_id: 'exc-friends-2026'}), 'not_my_giftee');
  const plain = f.call('claims.reserve', {id: jos.item_id}).id;
  refuses(f, () => f.call('claims.update', {id: plain, patch: {for_exchange_id: 'exc-friends-2026'}}), 'not_my_giftee');
  refuses(f, () => f.call('claims.update', {id: plain, patch: {for_exchange_id: 'exc-nowhere'}}), 'not_found');
  f.call('claims.update', {id, patch: {for_exchange_id: null}}); assert.deepEqual([mine().for_exchange_id, mine().over_budget], [null, null]);
  f.advance('2026-12-19T17:59:59-05:00'); assert.equal(status('exc-friends-2026'), 'drawn');
  f.advance('2026-12-19T18:00:00-05:00'); assert.equal(status('exc-friends-2026'), 'past');
  // An undrawn exchange: open, then closed at join_by, then expired at exchange_date.
  assert.equal(status('exc-family-cookies'), 'closed');
  f.advance('2026-12-20T13:59:59-05:00'); assert.equal(status('exc-family-cookies'), 'closed');
  f.advance('2026-12-20T14:00:00-05:00'); assert.equal(status('exc-family-cookies'), 'expired');
  rejects(f, ev('t14-9', '2026-12-20T15:00:00-05:00', 'exchange.drawn', {exchange_id: 'exc-family-cookies', assignments: []}));
});

test('T15 [all] the six events: addressing by ID and by match, rejections and notifications', () => {
  const f = start(), n0 = f.data.notifications.length, a0 = f.data.activity.length;
  f.event(require('../examples/scenario.json'));
  assert.deepEqual([f.data.notifications.length, f.data.notifications.at(-1).kind, f.data.notifications.at(-1).item_id], [n0 + 1, 'item.added', 'itm-tomas-031']);
  const row = f.data.activity.at(-1);
  assert.deepEqual([row.actor, row.action, row.object_id, row.event_id, row.request_id, row.at], ['event', 'item.added', 'itm-tomas-031', 'ev-rw-301', null, '2026-11-24T19:12:00-05:00']);
  const at = '2026-11-24T20:00:00-05:00', added = (id, extra = {}) => ev('x-' + id, at, 'item.added', {actor_member_id: 'mem-tomas', list_id: 'lst-tomas-family', item: {item_id: id, name: 'Thing ' + id, ...extra}});
  rejects(f, added('itm-tomas-031'));                                                                                             // duplicate ID
  rejects(f, added('itm-new-1', {name: 'enamel CAMP mug'}));                                                                      // name in use
  rejects(f, added('itm-new-2', {quantity_wanted: 21}));
  rejects(f, {...added('itm-new-3'), payload: {actor_member_id: 'mem-kamala', list_id: 'lst-tomas-family', item: {item_id: 'itm-new-3', name: 'N'}}});   // neither owner nor manager
  rejects(f, {...added('itm-new-4'), payload: {actor_member_id: 'mem-nobody', list_id: 'lst-tomas-family', item: {item_id: 'itm-new-4', name: 'N'}}});   // unknown member
  rejects(f, {...added('itm-new-5'), payload: {actor_member_id: 'mem-tomas', list_id: 'lst-nowhere', item: {item_id: 'itm-new-5', name: 'N'}}});          // unknown list
  rejects(f, {...added('itm-new-6'), payload: {actor_member_id: 'mem-priya', list_id: 'lst-priya-family', item: {item_id: 'itm-new-6', name: 'N'}}});     // the bound member acts through tools
  rejects(f, ev('x-c1', at, 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-031'}));                             // neither patch nor removed
  rejects(f, ev('x-c2', at, 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-031', item_match: {list_id: 'lst-tomas-family', name: 'Enamel camp mug'}, removed: true}));
  rejects(f, ev('x-c3', at, 'item.changed', {actor_member_id: 'mem-tomas', item_match: {list_id: 'lst-tomas-family', name: 'No such thing'}, removed: true}));  // no match
  rejects(f, ev('x-c4', at, 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-031', removed: false}));              // not removed
  rejects(f, ev('x-k1', at, 'claim.recorded', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-031', status: 'reserved'}));        // a list owner claims their own item
  rejects(f, ev('x-k2', at, 'claim.recorded', {actor_member_id: 'mem-kamala', item_id: 'itm-tomas-031', status: 'reserved', quantity: 3}));   // beyond remaining
  rejects(f, ev('x-k3', at, 'claim.recorded', {actor_member_id: 'mem-kamala', item_id: 'itm-tomas-031', status: 'released'}));       // nothing to release
  rejects(f, ev('x-k4', at, 'claim.recorded', {actor_member_id: 'mem-jo', item_id: 'itm-tomas-031', status: 'reserved'}));           // outside the list's group
  rejects(f, ev('x-o1', at, 'exchange.opened', {actor_member_id: 'mem-jo', exchange: {exchange_id: 'exc-x', group_id: 'grp-friends', name: 'autumn POTLUCK gifts', join_by: '2026-12-05T23:59:00-05:00', exchange_date: '2026-12-19T18:00:00-05:00'}}));
  rejects(f, ev('x-o2', at, 'exchange.opened', {actor_member_id: 'mem-jo', exchange: {exchange_id: 'exc-x', group_id: 'grp-family', name: 'X', join_by: '2026-12-05T23:59:00-05:00', exchange_date: '2026-12-19T18:00:00-05:00'}}));
  rejects(f, ev('x-m1', at, 'exchange.member_changed', {actor_member_id: 'mem-santi', exchange_match: {group_id: 'grp-friends', name: 'No such exchange'}, change: 'joined'}));
  assert.equal(f.data.activity.length, a0 + 1, 'a rejected event writes no activity row');
  // An event reaches a record the Agent created during the run by a key known when the task was written.
  const vest = f.call('items.add', {id: 'lst-priya-family', item: {name: 'Trail running vest'}}).id;
  f.event(ev('x-k5', '2026-11-24T21:00:00-05:00', 'claim.recorded', {actor_member_id: 'mem-dev', item_match: {list_id: 'lst-priya-family', name: ' trail running VEST '}, status: 'purchased'}));
  assert.deepEqual(f.data.claims.filter(c => c.item_id === vest).map(c => [c.member_id, c.status]), [['mem-dev', 'purchased']]);
  // After the Agent renames or removes it, the old name no longer matches: invalid_event, state unchanged.
  f.call('items.update', {id: vest, patch: {name: 'Trail vest'}});
  rejects(f, ev('x-k6', '2026-11-24T22:00:00-05:00', 'claim.recorded', {actor_member_id: 'mem-kamala', item_match: {list_id: 'lst-priya-family', name: 'Trail running vest'}, status: 'reserved'}));
  f.call('items.remove', {id: vest});
  rejects(f, ev('x-k7', '2026-11-24T22:00:00-05:00', 'claim.recorded', {actor_member_id: 'mem-kamala', item_match: {list_id: 'lst-priya-family', name: 'Trail vest'}, status: 'reserved'}));
  rejects(f, ev('x-k8', '2026-11-24T22:00:00-05:00', 'claim.recorded', {actor_member_id: 'mem-kamala', item_id: vest, status: 'reserved'}));
  f.event(ev('x-k9', '2026-11-24T22:10:00-05:00', 'claim.recorded', {actor_member_id: 'mem-dev', item_id: vest, status: 'released'}));
  // None of the Agent's own writes above produced a notification, and none of the claim events did.
  assert.equal(f.data.notifications.length, n0 + 1);
  // With the setting off, an added item is recorded but not announced.
  const quiet = seed(); quiet.settings.notify_item_added = false; quiet.settings.notify_exchange_activity = false;
  const q = start({seed: quiet}), m0 = q.data.notifications.length, own = q.call('exchanges.create', {id: 'grp-family', exchange: draw()}).id;
  q.event(require('../examples/scenario.json'));
  q.event(ev('q-1', '2026-11-24T20:00:00-05:00', 'exchange.member_changed', {actor_member_id: 'mem-dev', exchange_id: own, change: 'joined'}));
  assert.equal(q.data.notifications.length, m0); assert.ok(q.data.items.some(i => i.item_id === 'itm-tomas-031'));
});

test('T16 [all] seed validation, the bound member, and one activity row per committed write or applied event', () => {
  const ctx = {app_id: 'ribbonwell', virtual_now: CLOCK, binding: binding()};
  const invalid = (change, pattern, b) => { const s = seed(); change(s); assert.throws(() => plugin.validateSeed(b ? {...ctx, binding: b} : ctx, s), e => e.code === 'invalid_seed' && pattern.test(e.message), String(pattern)); };
  plugin.validateSeed(ctx, seed());
  invalid(s => { s.account_id = 'unbound-account'; }, /account declared in the run binding/);
  invalid(s => { s.members[0].person_id = null; }, /Exactly one member/);
  invalid(s => { s.members[2].person_id = 'person-priya'; }, /Exactly one member|share a person_id/);
  invalid(s => { s.members[2].person_id = 'person-unknown'; }, /not in the run binding/);
  invalid(s => { s.items[1].item_id = s.items[0].item_id; }, /Duplicate/);
  invalid(s => { s.items[0].list_id = 'lst-nowhere'; }, /unknown list/);
  invalid(s => { s.lists[0].owner_member_id = 'mem-jo'; }, /outside the list's group/);
  invalid(s => { s.lists[2].managed_by = 'mem-jo'; }, /manager is outside/);
  invalid(s => { const l = s.items.filter(i => i.list_id === 'lst-dev-family' && i.status === 'listed'); l[1].name = l[0].name.toUpperCase() + ' '; }, /share a name/);
  invalid(s => { const c = s.claims[0]; c.member_id = s.lists.find(l => l.list_id === s.items.find(i => i.item_id === c.item_id).list_id).owner_member_id; }, /own item/);
  invalid(s => { const c = s.claims.find(c => c.status === 'purchased'); s.claims.push({...c, claim_id: 'clm-copy'}); }, /two unreleased claims/);
  invalid(s => { s.claims.find(c => c.status === 'purchased').reserved_until = '2026-11-01T10:00:00-05:00'; }, /Only a reserved claim/);
  invalid(s => { s.exchanges[0].participant_ids.push('mem-jo'); }, /participant is outside/);
  invalid(s => { s.exchanges[0].assignments[0].receiver = s.exchanges[0].assignments[0].giver; }, /not a valid set/);
  invalid(s => { s.exchanges[1].assignments = [{giver: 'mem-wen', receiver: 'mem-noor'}]; }, /not a valid set/);
  invalid(s => { s.exchanges[0].exclusions.push(['mem-priya', 'mem-jo']); }, /exclusion/i);
  invalid(s => { s.exchanges[3].join_by = s.exchanges[3].exchange_date; }, /join_by must be before/);
  invalid(s => { s.activity[5].seq = 99; }, /numbered/);
  // Both date floors: nothing before 2025-01-01, nothing recorded after the current time.
  invalid(s => { s.lists[0].created_at = '2024-12-31T18:59:59-05:00'; }, /before 2025-01-01/);
  invalid(s => { s.items[0].updated_at = '2026-11-18T12:00:01-05:00'; }, /after the current time/);
  invalid(s => { s.notifications[0].at = '2026-11-18T09:00:01-08:00'; }, /after the current time/);
  { const s = seed(); s.lists[0].created_at = '2025-01-01T00:00:00Z'; plugin.validateSeed(ctx, s); }     // last year's history loads
  assert.ok(Date.parse(seed().lists.map(l => l.created_at).sort()[0]) < Date.parse('2026-01-01T00:00:00Z'), 'the fixture carries 2025 history');
  // The bound member is whoever carries the account owner's person_id; the display name plays no part.
  const renamed = seed(); renamed.members[0].name = 'P. Raman-Varga';
  assert.equal(fixture({seed: renamed}).call('account.get').account.name, 'P. Raman-Varga');
  const other = binding(); other.accounts[0].owner_person_id = 'person-tomas';
  const asTomas = fixture({binding: other});
  assert.equal(asTomas.call('account.get').account.member_id, 'mem-tomas');
  assert.equal(asTomas.call('lists.get', {id: 'lst-tomas-family'}).list.view, 'own');
  assert.equal(asTomas.call('lists.get', {id: 'lst-priya-family'}).items.find(i => i.name === 'Linen apron').claims[0].mine, true);
  invalid(() => {}, /Exactly one member/, {...binding(), people: [...binding().people, {person_id: 'person-x', name: 'X'}], accounts: [{app_id: 'ribbonwell', account_id: 'ribbonwell-priya', owner_person_id: 'person-x'}]});
  // Activity: numbered rows, one per committed write and applied event, none for a read or a refusal.
  const f = start(), rows = () => f.data.activity.length, r0 = rows();
  f.call('lists.list'); f.call('claims.list'); assert.equal(rows(), r0);
  refuses(f, () => f.call('claims.reserve', {id: 'itm-nowhere'}), 'not_found'); assert.equal(rows(), r0);
  const claim = f.call('claims.reserve', {id: TRAIN(f)}).id; f.call('claims.update', {id: claim, patch: {status: 'purchased'}});
  f.event(require('../examples/scenario.json'));
  assert.equal(rows(), r0 + 3);
  const last = f.data.activity.slice(-3);
  assert.deepEqual(last.map(r => [r.seq, r.actor, r.action]), [[r0 + 1, 'agent', 'claims.reserve'], [r0 + 2, 'agent', 'claims.update'], [r0 + 3, 'event', 'item.added']]);
  assert.deepEqual(last[1].replaced, {status: 'reserved'}); assert.ok(last[0].request_id && last[2].event_id === 'ev-rw-301');
  // Diagnostics are optional and never change a result.
  const on = fixture({logging: true}), off = fixture();
  on.event(require('../examples/scenario.json')); off.event(require('../examples/scenario.json'));
  assert.deepEqual(on.data, off.data); assert.ok(on.logs.length > 0);
});

test('fixtures: generated history is consistent, dated from 2025 and matches the plan\'s scale', () => {
  const s = seed(), now = Date.parse(CLOCK);
  assert.deepEqual([s.groups.length, s.members.length, s.lists.length, s.items.length, s.exchanges.length], [2, 13, 15, 130, 4]);
  assert.equal(s.lists.filter(l => l.managed_by !== null).length, 2);
  assert.ok(s.claims.length >= 70 && s.claims.length <= 80);
  for (const status of ['reserved', 'purchased', 'released']) assert.ok(s.claims.some(c => c.status === status), status);
  assert.ok(s.claims.some(c => c.status === 'reserved' && Date.parse(c.reserved_until) <= now) && s.claims.some(c => c.status === 'reserved' && Date.parse(c.reserved_until) > now));
  // Every claim fits its item's wanted quantity at the fixture time, and every run counter starts at zero.
  for (const i of s.items) assert.ok(derive.claimedQuantity(s, i.item_id, CLOCK) <= i.quantity_wanted, i.item_id);
  assert.deepEqual(s.counters, {item: 0, claim: 0, exchange: 0, notification: 0});
  const times = [...s.lists, ...s.items, ...s.claims].map(r => Date.parse(r.created_at)).sort((a, b) => a - b);
  assert.ok(times[0] >= Date.parse('2025-01-01T00:00:00Z') && times.at(-1) < now);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] < 45 * 86400000, 'no gap of more than six weeks');
  assert.ok([...s.items, ...s.claims, ...s.notifications, ...s.activity].every(r => /[+-]\d{2}:\d{2}$/.test(r.created_at || r.at)), 'every time carries its offset');
  assert.equal(require('../contribution/dataset.json').expected_counts.records, plugin.records(s).length);
  assert.equal(plugin.records(s).length, plugin.objects(s).length);
});

test('reviewer renderer escapes untrusted content', () => {
  const html = require('../gui/src/view.js').render([{item_id: 'x', name: '<img src=x onerror=alert(1)>', note: '<script>bad</script>'}]);
  assert.ok(!html.includes('<img') && !html.includes('<script>') && html.includes('&lt;'));
});
