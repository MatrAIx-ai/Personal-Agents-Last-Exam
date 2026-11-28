#!/usr/bin/env node
'use strict';
// Builds fixtures/minimal.json by replaying a fixed, seeded history through the App's own
// handlers (tools for the bound member, events for everyone else), so every stored record,
// notification and activity row is something the App itself produced.
// Run with --check to rebuild in memory and compare byte for byte.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');
const CLOCK = require('../fixtures/clock.json').initial_time;
const APP = 'ribbonwell';

// ---- deterministic helpers ----
let state = 0x5eed1e;
const rand = () => { state |= 0; state = state + 0x6D2B79F5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = rows => rows[int(0, rows.length - 1)];
const shuffle = rows => { const a = [...rows]; for (let i = a.length - 1; i > 0; i--) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Local times are Eastern; the offset follows the calendar (Node's built-in Intl), so both yearly changes are right.
const zone = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', timeZoneName: 'longOffset'});
function iso(utcMs) {
  const offset = zone.formatToParts(new Date(utcMs)).find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
  const minutes = (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  return new Date(utcMs + minutes * 60000).toISOString().slice(0, 19) + offset;
}
const at = text => Date.parse(text);                       // '2026-11-15T10:30:00-05:00'
const between = (from, to) => { const day = at(from) + int(0, Math.floor((at(to) - at(from)) / 86400000)) * 86400000; return day + int(8, 20) * 3600000 + int(0, 59) * 60000 - 12 * 3600000; };

// ---- people, groups, lists ----
const M = (id, name, person) => ({member_id: 'mem-' + id, name, person_id: person ? 'person-' + id : null});
const members = [M('priya', 'Priya Raman', true), M('tomas', 'Tomas Varga', true), M('leela', 'Leela Raman-Varga'), M('arun', 'Arun Raman-Varga'), M('kamala', 'Kamala Raman', true),
  M('dev', 'Dev Raman', true), M('meera', 'Meera Raman'), M('ravi', 'Ravi Raman'), M('anika', 'Anika Raman'), M('jo', 'Jo Okafor', true), M('santi', 'Santi Morales', true), M('noor', 'Noor Haddad'), M('wen', 'Wen Zhao')];
const family = ['priya', 'tomas', 'leela', 'arun', 'kamala', 'dev', 'meera', 'ravi', 'anika'], friends = ['priya', 'tomas', 'jo', 'santi', 'noor', 'wen'];
const groups = [{group_id: 'grp-family', name: 'Raman family', member_ids: family.map(x => 'mem-' + x)}, {group_id: 'grp-friends', name: 'Tuesday supper club', member_ids: friends.map(x => 'mem-' + x)}];
const managers = {leela: 'mem-priya', arun: 'mem-tomas'};
const occasions = {priya: ['Birthday', '2027-02-11T00:00:00-05:00'], tomas: ['Birthday', '2026-12-19T00:00:00-05:00'], leela: ['Birthday', '2027-01-09T00:00:00-05:00'], kamala: ['Birthday', '2027-03-02T00:00:00-05:00']};
const lists = [];
for (const [suffix, people, from] of [['family', family, '2025-01-04T12:00:00-05:00'], ['friends', friends, '2025-01-06T18:30:00-05:00']])
  people.forEach((p, i) => lists.push({list_id: 'lst-' + p + '-' + suffix, owner_member_id: 'mem-' + p, group_id: 'grp-' + suffix, managed_by: suffix === 'family' ? managers[p] || null : null,
    occasion_name: suffix === 'family' && occasions[p] ? occasions[p][0] : null, occasion_date: suffix === 'family' && occasions[p] ? occasions[p][1] : null, created_at: iso(at(from) + i * 3 * 86400000 + i * 4020000)}));

let data = {account_id: 'ribbonwell-priya', settings: {notify_item_added: true, notify_exchange_activity: true, draw_salt: 'rw-salt-7f3a9c1e5b2d4860'}, members, groups, lists,
  items: [], claims: [], exchanges: [], notifications: [], activity: [], counters: {item: 0, claim: 0, exchange: 0, notification: 0}};

// ---- replay through the App ----
let calls = 0, events = 0;
const ctx = (ms, role = 'agent') => ({app_id: APP, role, virtual_now: iso(ms), binding});
function tool(ms, name, args) {
  const out = plugin.handleTool(ctx(ms), structuredClone(data), APP + '.' + name, {...args, request_id: 'hist-' + String(++calls).padStart(4, '0'), expected_version: {epoch: 1, revision: calls}});
  plugin.validateSeed(ctx(ms), out.data); data = out.data; return out.result;
}
function event(ms, name, payload) {
  const e = {event_id: 'hist-ev-' + String(++events).padStart(4, '0'), at: iso(ms), operation: APP + '.' + name, payload};
  const next = plugin.applyEvent(ctx(ms, 'infra'), structuredClone(data), e); plugin.validateSeed(ctx(ms), next); data = next;
}
const queue = [];
let order = 0;
const plan = (ms, run) => queue.push({ms, order: order++, run});

// ---- item pools (all invented; no brand, product line or real shop) ----
const STORES = ['Fennel & Rye', 'Copperleaf Books', 'Tumble & Thread', 'Larkspur Outfitters', 'Hobb & Marrow Kitchen', 'Pinwheel Toyworks', 'Quillfeather Paper', 'Saltmeadow Home', 'Brambleworks Hardware', 'Mossgate Garden'];
const ADULT = [['Linen tea towels', 'set of 3', 2400], ['Ceramic pour-over cone', 'speckled white', 3200], ['Merino hiking socks', 'size M', 2200], ['Hardcover sketchbook', 'A4, dot grid', 1900],
  ['Beeswax candles', 'pair, 25 cm', 1600], ['Enamel roasting dish', 'navy', 4200], ['Wool picnic blanket', 'heather grey', 7800], ['Garden hand trowel', 'ash handle', 2600], ['Fountain pen', 'fine nib', 5400],
  ['Leather key loop', 'tan', 1800], ['Bird-seed feeder', 'cedar', 3600], ['Travel chess set', 'magnetic', 2900], ['Cookbook stand', 'oak', 3400], ['Reading lamp', 'clip-on, warm', 3900],
  ['Stoneware mugs', 'set of 2', 3000], ['Sourdough proofing basket', 'round, 22 cm', 2100], ['Canvas tote', 'undyed', 1500], ['Thermal flask', '750 ml', 3300], ['Pruning shears', 'bypass', 4100],
  ['Board game: Lantern Harbour', null, 4500], ['Jigsaw puzzle', '1000 pieces, tide pools', 2700], ['Wool beanie', 'rust', 2800], ['Leather-bound journal', 'ruled', 3700], ['Herb drying rack', 'three tiers', 2500],
  ['Spice tins', 'set of 6', 2300], ['Bicycle bell', 'brass', 1700], ['Trail map case', 'waterproof', 1900], ['Watercolour pans', 'set of 12', 4800], ['Knitting needles', 'bamboo, 5 mm', 1200],
  ['Record cleaning kit', null, 2600], ['Seed-starting trays', 'set of 4', 1800], ['Pocket binoculars', '8x21', 6900], ['Olive-wood spoon set', null, 2900], ['Desk plant pot', 'terracotta, 14 cm', 1400],
  ['Flannel pillowcases', 'pair, moss', 3100], ['Camp lantern', 'rechargeable', 4400], ['Cheese board', 'slate', 3500], ['Shoe-care kit', null, 2700], ['Hand-bound photo album', '40 pages', 5200],
  ['Bread knife', '23 cm', 4600], ['Card game: Six Kettles', null, 1600], ['Running belt', 'reflective', 2400], ['Headlamp', '300 lumen', 3800], ['Tea sampler', 'eight tins', 3300]];
const CHILD = [['Wooden building blocks', '60 pieces', 3400], ['Picture book: The Owl Who Counted', null, 1500], ['Rain boots', 'yellow, size 11', 2800], ['Balance bike helmet', 'size S', 3200],
  ['Felt-tip pens', 'set of 24', 1300], ['Kite', 'delta, 120 cm', 2200], ['Dinosaur floor puzzle', '48 pieces', 1800], ['Glow-in-the-dark stars', 'pack of 100', 900], ['Junior gardening set', null, 2100],
  ['Wooden marble run', null, 4900], ['Storybook: Nine Sleepy Foxes', null, 1400], ['Scooter bell', 'red', 800], ['Play tent', 'striped', 5600], ['Beginner recorder', null, 1700]];
// Each item is sold where such a thing would be: the shop is drawn from the shops of the item's kind.
const SHOPS = {kitchen: ['Hobb & Marrow Kitchen', 'Fennel & Rye'], outdoor: ['Larkspur Outfitters'], paper: ['Quillfeather Paper', 'Copperleaf Books'], books: ['Copperleaf Books'], toys: ['Pinwheel Toyworks'],
  home: ['Saltmeadow Home'], textile: ['Tumble & Thread', 'Saltmeadow Home'], garden: ['Mossgate Garden', 'Brambleworks Hardware'], hardware: ['Brambleworks Hardware'], games: ['Pinwheel Toyworks', 'Copperleaf Books']};
const KIND = {'Linen tea towels': 'textile', 'Ceramic pour-over cone': 'kitchen', 'Merino hiking socks': 'outdoor', 'Hardcover sketchbook': 'paper', 'Beeswax candles': 'home', 'Enamel roasting dish': 'kitchen',
  'Wool picnic blanket': 'outdoor', 'Garden hand trowel': 'garden', 'Fountain pen': 'paper', 'Leather key loop': 'home', 'Bird-seed feeder': 'garden', 'Travel chess set': 'games', 'Cookbook stand': 'kitchen',
  'Reading lamp': 'home', 'Stoneware mugs': 'kitchen', 'Sourdough proofing basket': 'kitchen', 'Canvas tote': 'textile', 'Thermal flask': 'outdoor', 'Pruning shears': 'garden', 'Board game: Lantern Harbour': 'games',
  'Jigsaw puzzle': 'games', 'Wool beanie': 'textile', 'Leather-bound journal': 'paper', 'Herb drying rack': 'garden', 'Spice tins': 'kitchen', 'Bicycle bell': 'hardware', 'Trail map case': 'outdoor',
  'Watercolour pans': 'paper', 'Knitting needles': 'textile', 'Record cleaning kit': 'home', 'Seed-starting trays': 'garden', 'Pocket binoculars': 'outdoor', 'Olive-wood spoon set': 'kitchen',
  'Desk plant pot': 'garden', 'Flannel pillowcases': 'textile', 'Camp lantern': 'outdoor', 'Cheese board': 'kitchen', 'Shoe-care kit': 'home', 'Hand-bound photo album': 'paper', 'Bread knife': 'kitchen',
  'Card game: Six Kettles': 'games', 'Running belt': 'outdoor', 'Headlamp': 'outdoor', 'Tea sampler': 'kitchen', 'Wooden building blocks': 'toys', 'Picture book: The Owl Who Counted': 'books',
  'Rain boots': 'outdoor', 'Balance bike helmet': 'outdoor', 'Felt-tip pens': 'paper', 'Kite': 'toys', 'Dinosaur floor puzzle': 'toys', 'Glow-in-the-dark stars': 'toys', 'Junior gardening set': 'garden',
  'Wooden marble run': 'toys', 'Storybook: Nine Sleepy Foxes': 'books', 'Scooter bell': 'hardware', 'Play tent': 'toys', 'Beginner recorder': 'toys'};
const shopFor = name => { if (!KIND[name]) throw Error('No kind for ' + name); return pick(SHOPS[KIND[name]]); };
const ownerOf = l => l.owner_member_id.slice(4);
const counts = {};
const itemId = owner => { let id; do { id = 'itm-' + owner + '-' + String(counts[owner] = (counts[owner] || 0) + 1).padStart(3, '0'); } while (FIXED_IDS.has(id)); return id; };
const FIXED = {   // records the acceptance plan names
  'lst-tomas-family': [{id: 'itm-tomas-006', name: 'Cast-iron skillet', variant: '26 cm', price_cents: 5900, store: 'Hobb & Marrow Kitchen', q: 1, when: '2026-09-12T09:15:00-04:00'},
    {id: 'itm-tomas-014', name: 'Rain shell', variant: 'size M', price_cents: 12900, store: 'Larkspur Outfitters', q: 1, when: '2026-10-03T18:40:00-04:00'}],
  'lst-priya-family': [{name: 'Linen apron', variant: 'charcoal', price_cents: 3800, store: 'Saltmeadow Home', q: 1, when: '2026-08-20T08:05:00-04:00'}],
  'lst-leela-family': [{name: 'Wooden train set', variant: 'figure-eight track', price_cents: 4200, store: 'Pinwheel Toyworks', q: 2, when: '2026-10-18T16:20:00-04:00'}],
  'lst-santi-friends': [{id: 'itm-santi-007', name: 'Espresso grinder', variant: 'hand-cranked', price_cents: 8900, store: 'Hobb & Marrow Kitchen', q: 1, when: '2026-10-25T11:00:00-04:00'}]
};
const FIXED_IDS = new Set(Object.values(FIXED).flat().map(f => f.id).filter(Boolean));
const TARGET = {'lst-priya-family': 9, 'lst-tomas-family': 9, 'lst-leela-family': 9, 'lst-arun-family': 9, 'lst-kamala-family': 9, 'lst-dev-family': 9, 'lst-meera-family': 9, 'lst-ravi-family': 8, 'lst-anika-family': 8,
  'lst-priya-friends': 9, 'lst-tomas-friends': 8, 'lst-jo-friends': 9, 'lst-santi-friends': 9, 'lst-noor-friends': 8, 'lst-wen-friends': 8};
function addItem(l, ms, f) {
  const owner = ownerOf(l), mine = l.owner_member_id === 'mem-priya' || l.managed_by === 'mem-priya';
  const item = {name: f.name, variant: f.variant ?? null, price_cents: f.price_cents ?? null, store: f.store ?? null, priority: f.priority || 'medium', quantity_wanted: f.q || 1};
  if (mine) plan(ms, () => { const id = tool(ms, 'items.add', {id: l.list_id, item}).id; rename[id] = f.id || itemId(owner); });
  else { const id = f.id || itemId(owner); plan(ms, () => event(ms, 'item.added', {actor_member_id: l.managed_by || l.owner_member_id, list_id: l.list_id, item: {item_id: id, ...item}})); }
}
const rename = {};
for (const l of lists) {
  const fixed = FIXED[l.list_id] || [], child = ['leela', 'arun'].includes(ownerOf(l));
  const pool = shuffle(child ? CHILD : ADULT).slice(0, TARGET[l.list_id] - fixed.length);
  pool.forEach(([name, variant, price], i) => {
    // Lists fill up from their first days: two items between late January and April 2025, more through that year, the rest up to autumn 2026, the last one this month.
    const ms = i < 2 ? between('2025-01-29T12:00:00-05:00', '2025-04-30T12:00:00-04:00') : i < 5 ? between('2025-03-15T12:00:00-04:00', '2025-12-10T12:00:00-05:00') : i >= pool.length - 1 ? between('2026-11-02T12:00:00-05:00', '2026-11-16T12:00:00-05:00') : between('2025-06-01T12:00:00-04:00', '2026-10-30T12:00:00-04:00');
    addItem(l, ms, {name, variant, price_cents: rand() < 0.12 ? null : price + int(-3, 6) * 100, store: rand() < 0.15 ? null : shopFor(name), priority: pick(['low', 'medium', 'medium', 'high']), q: rand() < 0.12 ? int(2, 4) : 1});
  });
  for (const f of fixed) addItem(l, at(f.when), f);
}

// ---- exchanges ----
const fam = groups[0].member_ids;
// 1. Last year's family draw, organized by the bound member (reads past).
plan(at('2025-11-10T19:30:00-05:00'), () => { const id = tool(at('2025-11-10T19:30:00-05:00'), 'exchanges.create', {id: 'grp-family', exchange: {name: 'Family draw 2025', budget_cents: 3500,
  join_by: '2025-11-30T23:59:00-05:00', exchange_date: '2025-12-24T18:00:00-05:00', exclusions: [['mem-priya', 'mem-tomas'], ['mem-kamala', 'mem-ravi']]}}).id; rename[id] = 'exc-family-2025';
  tool(at('2025-11-10T19:32:00-05:00'), 'exchanges.join', {id}); });
['tomas', 'kamala', 'dev', 'meera', 'ravi', 'anika'].forEach((p, i) => plan(at('2025-11-12T08:00:00-05:00') + i * 26 * 3600000, () =>
  event(at('2025-11-12T08:00:00-05:00') + i * 26 * 3600000, 'exchange.member_changed', {actor_member_id: 'mem-' + p, exchange_match: {group_id: 'grp-family', name: 'Family draw 2025'}, change: 'joined'})));
plan(at('2025-11-19T21:10:00-05:00'), () => event(at('2025-11-19T21:10:00-05:00'), 'exchange.member_changed', {actor_member_id: 'mem-anika', exchange_match: {group_id: 'grp-family', name: 'Family draw 2025'}, change: 'left'}));
plan(at('2025-11-21T07:45:00-05:00'), () => event(at('2025-11-21T07:45:00-05:00'), 'exchange.member_changed', {actor_member_id: 'mem-anika', exchange_match: {group_id: 'grp-family', name: 'Family draw 2025'}, change: 'joined'}));
plan(at('2025-12-01T09:00:00-05:00'), () => tool(at('2025-12-01T09:00:00-05:00'), 'exchanges.draw', {id: data.exchanges[0].exchange_id}));
// 2. A friends' swap nobody drew (reads expired).
plan(at('2026-03-14T10:00:00-04:00'), () => event(at('2026-03-14T10:00:00-04:00'), 'exchange.opened', {actor_member_id: 'mem-wen', exchange: {exchange_id: 'exc-friends-plants', group_id: 'grp-friends', name: 'Spring plant swap',
  budget_cents: 2000, join_by: '2026-04-05T23:59:00-04:00', exchange_date: '2026-04-18T15:00:00-04:00', exclusions: []}}));
plan(at('2026-03-16T12:20:00-04:00'), () => event(at('2026-03-16T12:20:00-04:00'), 'exchange.member_changed', {actor_member_id: 'mem-noor', exchange_id: 'exc-friends-plants', change: 'joined'}));
// 3. A friends' exchange drawn by its organizer (reads drawn); the bound member takes part.
plan(at('2026-10-20T17:00:00-04:00'), () => event(at('2026-10-20T17:00:00-04:00'), 'exchange.opened', {actor_member_id: 'mem-jo', exchange: {exchange_id: 'exc-friends-potluck', group_id: 'grp-friends', name: 'Autumn potluck gifts',
  budget_cents: 3000, join_by: '2026-11-10T23:59:00-05:00', exchange_date: '2026-12-05T18:30:00-05:00', exclusions: [['mem-priya', 'mem-tomas']]}}));
plan(at('2026-10-21T08:10:00-04:00'), () => tool(at('2026-10-21T08:10:00-04:00'), 'exchanges.join', {id: 'exc-friends-potluck'}));
['tomas', 'noor', 'wen'].forEach((p, i) => plan(at('2026-10-22T09:00:00-04:00') + i * 30 * 3600000, () =>
  event(at('2026-10-22T09:00:00-04:00') + i * 30 * 3600000, 'exchange.member_changed', {actor_member_id: 'mem-' + p, exchange_id: 'exc-friends-potluck', change: 'joined'})));
plan(at('2026-11-11T08:30:00-05:00'), () => event(at('2026-11-11T08:30:00-05:00'), 'exchange.drawn', {exchange_id: 'exc-friends-potluck', assignments: [
  {giver: 'mem-jo', receiver: 'mem-tomas'}, {giver: 'mem-tomas', receiver: 'mem-wen'}, {giver: 'mem-wen', receiver: 'mem-priya'}, {giver: 'mem-priya', receiver: 'mem-noor'}, {giver: 'mem-noor', receiver: 'mem-jo'}]}));
// 4. A family exchange still open for December 2026; the bound member has not joined.
plan(at('2026-11-12T20:15:00-05:00'), () => event(at('2026-11-12T20:15:00-05:00'), 'exchange.opened', {actor_member_id: 'mem-meera', exchange: {exchange_id: 'exc-family-cookies', group_id: 'grp-family', name: 'Cousins\' cookie tin exchange',
  budget_cents: 1500, join_by: '2026-12-01T23:59:00-05:00', exchange_date: '2026-12-20T14:00:00-05:00', exclusions: []}}));
plan(at('2026-11-13T07:50:00-05:00'), () => event(at('2026-11-13T07:50:00-05:00'), 'exchange.member_changed', {actor_member_id: 'mem-anika', exchange_id: 'exc-family-cookies', change: 'joined'}));

// ---- claims ----
const sharedGroups = (a, b) => groups.filter(g => g.member_ids.includes(a) && g.member_ids.includes(b)).map(g => g.group_id);
function eligible(ms, claimer, filter = () => true) {
  const now = iso(ms);
  return data.items.filter(i => { const l = data.lists.find(l => l.list_id === i.list_id);
    return i.status === 'listed' && l.owner_member_id !== claimer && data.groups.find(g => g.group_id === l.group_id).member_ids.includes(claimer) && filter(i, l) &&
      !data.claims.some(c => c.item_id === i.item_id && c.member_id === claimer && c.status !== 'released') &&
      i.quantity_wanted - data.claims.filter(c => c.item_id === i.item_id && (c.status === 'purchased' || c.status === 'reserved' && Date.parse(c.reserved_until) > ms)).reduce((s, c) => s + c.quantity, 0) >= 1; });
}
const adults = members.filter(m => !['mem-leela', 'mem-arun'].includes(m.member_id)).map(m => m.member_id);
// kind: purchased (reserve, then buy), released (reserve, then release), lapsed (reserve long ago), held (reserve this month)
function claim(ms, claimer, kind, filter, extra = {}) {
  plan(ms, () => {
    const options = eligible(ms, claimer, filter); if (!options.length) throw Error('No eligible item for a planned claim: ' + claimer + ' ' + kind + ' ' + iso(ms));
    const item = extra.first ? options[0] : pick(options), mine = claimer === 'mem-priya', later = ms + int(1, 6) * 86400000 + int(1, 9) * 1800000;
    let id;
    if (mine) { id = tool(ms, 'claims.reserve', {id: item.item_id, ...(extra.note ? {note: extra.note} : {}), ...(extra.tag ? {for_exchange_id: extra.tag()} : {})}).id; rename[id] = 'clm-priya-' + String(counts.claims = (counts.claims || 0) + 1).padStart(3, '0'); }
    else { id = 'clm-' + claimer.slice(4) + '-' + String(counts['c' + claimer] = (counts['c' + claimer] || 0) + 1).padStart(3, '0'); event(ms, 'claim.recorded', {actor_member_id: claimer, item_id: item.item_id, claim_id: id, status: 'reserved'}); }
    if (kind === 'purchased') plan(later, () => mine ? tool(later, 'claims.update', {id, patch: {status: 'purchased'}}) : event(later, 'claim.recorded', {actor_member_id: claimer, item_id: item.item_id, status: 'purchased'}));
    if (kind === 'released') plan(later, () => mine ? tool(later, 'claims.release', {id}) : event(later, 'claim.recorded', {actor_member_id: claimer, item_id: item.item_id, status: 'released'}));
  });
}
// n dates spread evenly over a period: the period is cut into n equal parts and one day is drawn in each.
const spread = (from, to, n, i) => { const a = at(from), step = (at(to) - a) / n; return between(iso(a + step * i), iso(a + step * (i + 1) - 86400000)); };
const named = (list, name) => (i, l) => l.list_id === list && i.name === name;
const onList = list => (i, l) => l.list_id === list;
const notOn = (...lists) => (i, l) => !lists.includes(l.list_id) && !Object.values(FIXED).flat().some(f => f.name === i.name);
const others = adults.filter(m => m !== 'mem-priya');
// The six claims on the bound member's own family list (she never sees them).
claim(at('2026-11-08T13:10:00-05:00'), 'mem-tomas', 'purchased', named('lst-priya-family', 'Linen apron'));
claim(at('2025-12-05T10:00:00-05:00'), 'mem-kamala', 'purchased', onList('lst-priya-family'));
claim(at('2026-11-12T19:00:00-05:00'), 'mem-dev', 'held', onList('lst-priya-family'));
claim(at('2026-09-28T09:30:00-04:00'), 'mem-meera', 'lapsed', onList('lst-priya-family'));
claim(at('2026-06-03T15:45:00-04:00'), 'mem-ravi', 'released', onList('lst-priya-family'));
claim(at('2026-02-01T11:20:00-05:00'), 'mem-anika', 'purchased', onList('lst-priya-family'));
// Named in the acceptance plan.
claim(at('2026-11-15T10:30:00-05:00'), 'mem-kamala', 'held', named('lst-tomas-family', 'Cast-iron skillet'));
claim(at('2026-11-14T20:05:00-05:00'), 'mem-priya', 'held', named('lst-tomas-family', 'Rain shell'), {note: 'Check the size with Tomas\'s sister before buying.'});
plan(at('2026-11-10T14:00:00-05:00'), () => { const item = data.items.find(i => i.name === 'Wooden train set');
  event(at('2026-11-10T14:00:00-05:00'), 'claim.recorded', {actor_member_id: 'mem-kamala', item_id: item.item_id, claim_id: 'clm-kamala-train', status: 'purchased', quantity: 1}); });
// The bound member's own shopping: one gift for last year's draw, tagged with the exchange.
claim(at('2025-12-06T12:00:00-05:00'), 'mem-priya', 'purchased', (i, l) => { const x = data.exchanges[0], a = x.assignments.find(a => a.giver === 'mem-priya'); return l.owner_member_id === a.receiver && l.group_id === 'grp-family'; },
  {first: true, tag: () => data.exchanges[0].exchange_id, note: 'For the 2025 family draw.'});
const free = notOn('lst-priya-family', 'lst-priya-friends');
for (const [kind, n, from, to] of [['purchased', 5, '2025-03-20T12:00:00-04:00', '2026-10-20T12:00:00-04:00'], ['released', 2, '2025-05-10T12:00:00-04:00', '2026-09-30T12:00:00-04:00'],
  ['lapsed', 2, '2026-09-05T12:00:00-04:00', '2026-10-28T12:00:00-04:00'], ['held', 2, '2026-11-06T12:00:00-05:00', '2026-11-16T12:00:00-05:00']])
  for (let i = 0; i < n; i++) claim(spread(from, to, n, i), 'mem-priya', kind, free);
// Everybody else's claims on each other's lists.
// Birthdays fall all through the year, so people reserve and buy from the first spring on.
for (const [kind, n, from, to] of [['purchased', 33, '2025-02-03T12:00:00-05:00', '2026-10-31T12:00:00-04:00'], ['released', 7, '2025-02-12T12:00:00-05:00', '2026-10-15T12:00:00-04:00'],
  ['lapsed', 6, '2026-08-20T12:00:00-04:00', '2026-10-30T12:00:00-04:00'], ['held', 7, '2026-11-05T12:00:00-05:00', '2026-11-16T12:00:00-05:00']])
  for (let i = 0; i < n; i++) claim(spread(from, to, n, i), pick(others), kind, free);

// ---- later changes by list owners ----
// Two material changes and one removal hit items the bound member has claimed (three claim.item_changed notifications at most).
function ownerChange(ms, select, change) {
  plan(ms, () => { const item = select(); if (!item) return; const l = data.lists.find(l => l.list_id === item.list_id), actor = l.managed_by || l.owner_member_id;
    if (actor === 'mem-priya') return; event(ms, 'item.changed', {actor_member_id: actor, item_id: item.item_id, ...change(item)}); });
}
const priyaClaimed = status => () => { const c = data.claims.filter(c => c.member_id === 'mem-priya' && c.status === status && !FIXED['lst-tomas-family'].some(f => f.id === c.item_id || rename[c.item_id] === f.id))
  .map(c => data.items.find(i => i.item_id === c.item_id)).filter(i => i.status === 'listed' && i.name !== 'Rain shell'); return c[0]; };
ownerChange(at('2025-10-06T19:20:00-04:00'), priyaClaimed('purchased'), i => ({patch: {price_cents: (i.price_cents || 2000) + 300}}));
ownerChange(at('2026-10-12T09:00:00-04:00'), priyaClaimed('purchased'), i => ({patch: {variant: (i.variant ? i.variant + ', ' : '') + 'gift-wrapped'}}));
ownerChange(at('2026-11-09T18:30:00-05:00'), priyaClaimed('reserved'), i => ({patch: {price_cents: (i.price_cents || 2000) + 500}}));
const unclaimed = () => shuffle(data.items.filter(i => i.status === 'listed' && !Object.values(FIXED).flat().some(f => f.name === i.name) && !data.claims.some(c => c.item_id === i.item_id) &&
  !['mem-priya'].includes(data.lists.find(l => l.list_id === i.list_id).owner_member_id) && data.lists.find(l => l.list_id === i.list_id).managed_by !== 'mem-priya'));
for (let i = 0; i < 5; i++) ownerChange(between('2026-03-01T12:00:00-05:00', '2026-10-25T12:00:00-04:00'), () => unclaimed()[0], () => ({removed: true}));
for (let i = 0; i < 4; i++) ownerChange(between('2026-04-01T12:00:00-04:00', '2026-10-25T12:00:00-04:00'), () => unclaimed()[0], it => ({patch: {note: 'Any colour is fine.', quantity_wanted: Math.min(20, it.quantity_wanted + 1)}}));
// The bound member tidies her own list once: removes an item and restores it, and removes another for good.
plan(at('2026-07-19T10:00:00-04:00'), () => { const mine = data.items.filter(i => i.list_id === 'lst-priya-friends' && i.status === 'listed'); tool(at('2026-07-19T10:00:00-04:00'), 'items.remove', {id: mine[0].item_id});
  tool(at('2026-07-19T10:06:00-04:00'), 'items.restore', {id: mine[0].item_id}); tool(at('2026-07-19T10:09:00-04:00'), 'items.remove', {id: mine[1].item_id}); });

// ---- run ----
while (queue.length) { queue.sort((a, b) => a.ms - b.ms || a.order - b.order); const next = queue.shift(); if (next.ms >= at(CLOCK)) throw Error('History reaches past the fixture clock.'); next.run(); }

// ---- history IDs replace the run counters, which start again from zero ----
let n = 0;
for (const note of data.notifications) rename[note.notification_id] = 'ntf-' + String(++n).padStart(3, '0');
let text = JSON.stringify(data);
for (const [from, to] of Object.entries(rename).sort((a, b) => b[0].length - a[0].length)) text = text.split('"' + from + '"').join('"' + to + '"');
data = JSON.parse(text);
data.counters = {item: 0, claim: 0, exchange: 0, notification: 0};
plugin.validateSeed({app_id: APP, virtual_now: CLOCK, binding}, data);
const ids = [...data.items.map(i => i.item_id), ...data.claims.map(c => c.claim_id)];
if (new Set(ids).size !== ids.length) throw Error('Renamed IDs collide.');

const summary = {lists: data.lists.length, items: data.items.length, removed_items: data.items.filter(i => i.status === 'removed').length, claims: data.claims.length,
  claims_by_status: Object.fromEntries(['reserved', 'purchased', 'released'].map(s => [s, data.claims.filter(c => c.status === s).length])),
  lapsed_at_clock: data.claims.filter(c => c.status === 'reserved' && Date.parse(c.reserved_until) <= Date.parse(CLOCK)).length,
  claims_on_bound_member_family_list: data.claims.filter(c => data.items.find(i => i.item_id === c.item_id).list_id === 'lst-priya-family').length,
  exchanges: data.exchanges.length, notifications: data.notifications.length, activity: data.activity.length,
  first_record: data.lists.map(l => l.created_at).sort()[0], last_record: data.activity[data.activity.length - 1].at};
// ---- what happens after the clock: 18 November to 31 December 2026 ----
// These records are not in the seed. Each exists only once its event is applied, so nothing dated after the clock can be read before its time.
// The events are built by applying them, in order, to a copy of the finished seed, so each one is valid when the ones before it have run.
const seed = structuredClone(data);
state = 0x1a7e2026;
const later = [], sch = {};
let sn = 0;
const stage = (ms, name, payload) => later.push({ms, name, payload});
const day = (d, h, m) => at(d + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00-05:00');
const theirs = lists.filter(l => l.owner_member_id !== 'mem-priya' && l.managed_by !== 'mem-priya');
const GIFTS = [['Enamel roasting dish', 'oval', 4800], ['Wool beanie', 'rust', 2600], ['Thermal flask', '750 ml', 3400], ['Jigsaw puzzle', '1000 pieces, winter harbour', 2200], ['Beeswax candles', 'set of six', 1900],
  ['Leather-bound journal', 'lined', 3100], ['Spice tins', 'set of eight', 2400], ['Camp lantern', 'rechargeable', 3900], ['Tea sampler', 'twelve tins', 2800], ['Knitting needles', 'bamboo, 5 mm', 1400],
  ['Reading lamp', 'clip-on', 2700], ['Olive-wood spoon set', null, 2300], ['Pocket binoculars', '8x21', 5200], ['Flannel pillowcases', 'pair, grey check', 3000], ['Board game: Lantern Harbour', null, 4400], ['Cheese board', 'slate', 3600]];
const days = ['2026-11-19', '2026-11-21', '2026-11-23', '2026-11-27', '2026-11-28', '2026-11-30', '2026-12-02', '2026-12-04', '2026-12-06', '2026-12-09', '2026-12-11', '2026-12-13', '2026-12-16', '2026-12-19', '2026-12-26', '2026-12-29'];
GIFTS.forEach((gift, i) => stage(day(days[i], int(8, 21), int(0, 59)), 'add', gift));
['dev', 'kamala', 'ravi', 'tomas'].forEach((p, i) => stage(day(['2026-11-20', '2026-11-22', '2026-11-25', '2026-11-29'][i], 9 + 3 * i, 12 * i + 5), 'exchange.member_changed', {actor_member_id: 'mem-' + p, exchange_id: 'exc-family-cookies', change: 'joined'}));
stage(day('2026-12-02', 8, 30), 'exchange.drawn', {exchange_id: 'exc-family-cookies', assignments: 'cycle'});
// Holiday shopping: holds and purchases on other people's lists, chosen when the event is built from what is free at that moment.
const shopDays = ['2026-11-20', '2026-11-24', '2026-11-27', '2026-11-28', '2026-11-30', '2026-12-01', '2026-12-03', '2026-12-05', '2026-12-07', '2026-12-08', '2026-12-10', '2026-12-12', '2026-12-14', '2026-12-15', '2026-12-17', '2026-12-18', '2026-12-20', '2026-12-22', '2026-12-27', '2026-12-30'];
shopDays.forEach((d, i) => stage(day(d, int(9, 20), int(0, 59)), 'hold', {claimer: pick(others), buy: i % 4 !== 3}));
['2026-11-26', '2026-12-10', '2026-12-21', '2026-12-28', '2026-12-31'].forEach((d, i) => stage(day(d, 11 + i % 3, 10 * i + 4), 'owner', {removed: i === 3}));
const schedule = [];
const emit = (ms, name, payload) => { const e = {event_id: 'sch-rw-' + String(++sn).padStart(3, '0'), at: iso(ms), operation: APP + '.' + name, payload};
  const next = plugin.applyEvent(ctx(ms, 'infra'), structuredClone(data), e); plugin.validateSeed(ctx(ms), next); data = next; schedule.push(e); };
while (later.length) { later.sort((a, b) => a.ms - b.ms); const e = later.shift(), ms = e.ms;
  if (ms < at(CLOCK) || ms > at('2026-12-31T23:59:00-05:00')) throw Error('A scheduled event falls outside 18 November to 31 December 2026.');
  if (e.name === 'add') { const [name, variant, price] = e.payload, l = pick(theirs.filter(l => !data.items.some(i => i.list_id === l.list_id && i.name === name))), owner = ownerOf(l);
    emit(ms, 'item.added', {actor_member_id: l.managed_by || l.owner_member_id, list_id: l.list_id, item: {item_id: 'itm-' + owner + '-s' + String(sch[owner] = (sch[owner] || 0) + 1).padStart(2, '0'),
      name, variant, price_cents: price, store: shopFor(name), priority: pick(['low', 'medium', 'high']), quantity_wanted: 1}});
  } else if (e.name === 'hold') { const options = eligible(ms, e.payload.claimer, (i, l) => l.list_id !== 'lst-priya-family' && !Object.values(FIXED).flat().some(f => f.name === i.name));
    const item = pick(options), id = 'clm-' + e.payload.claimer.slice(4) + '-s' + String(sch['c' + e.payload.claimer] = (sch['c' + e.payload.claimer] || 0) + 1).padStart(2, '0');
    emit(ms, 'claim.recorded', {actor_member_id: e.payload.claimer, item_id: item.item_id, claim_id: id, status: 'reserved'});
    const bought = ms + int(1, 4) * 86400000 + int(1, 6) * 1800000;
    if (e.payload.buy && bought < at('2026-12-31T22:00:00-05:00')) stage(bought, 'claim.recorded', {actor_member_id: e.payload.claimer, item_id: item.item_id, status: 'purchased'});
  } else if (e.name === 'owner') { const item = unclaimed()[0], l = data.lists.find(l => l.list_id === item.list_id);
    emit(ms, 'item.changed', {actor_member_id: l.managed_by || l.owner_member_id, item_id: item.item_id, ...(e.payload.removed ? {removed: true} : {patch: {note: pick(['Either colour works.', 'The smaller size, please.', 'No rush on this one.'])}})});
  } else if (e.name === 'exchange.drawn') { const ids = data.exchanges.find(x => x.exchange_id === 'exc-family-cookies').participant_ids;
    emit(ms, e.name, {exchange_id: 'exc-family-cookies', assignments: ids.map((giver, i) => ({giver, receiver: ids[(i + 1) % ids.length]}))});
  } else emit(ms, e.name, e.payload);
}
const after = data; data = seed;
const summaryLater = {events: schedule.length, first: schedule[0].at, last: schedule.at(-1).at, items_added: after.items.length - seed.items.length, claims_added: after.claims.length - seed.claims.length,
  notifications_added: after.notifications.length - seed.notifications.length, activity_added: after.activity.length - seed.activity.length};
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'contribution/dataset.json'), 'utf8'));
dataset.expected_counts = {records: plugin.records(data).length, assets: 0};
const files = {'fixtures/schedules/late-2026.json': JSON.stringify(schedule, null, 1) + '\n', 'fixtures/minimal.json': JSON.stringify(data, null, 1) + '\n', 'contribution/dataset.json': JSON.stringify(dataset, null, 2) + '\n'};
let drift = false;
for (const [name, body] of Object.entries(files)) {
  const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true});
  if (process.argv.includes('--check')) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) { drift = true; console.error('Generated file drift: ' + name); } }
  else fs.writeFileSync(file, body);
}
if (drift) process.exitCode = 1; else console.log(JSON.stringify({...summary, scheduled_after_clock: summaryLater}, null, 1));
