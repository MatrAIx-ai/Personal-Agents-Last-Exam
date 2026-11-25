#!/usr/bin/env node
'use strict';
// Builds the reference fixture deterministically: fixtures/reference.json, the script-drawn PNG
// files in assets/, contribution/assets.catalog.json and the counts in contribution/dataset.json.
// Everything is fictional. The account was opened on 2025-01-04 and the phone's first sync backed up
// its older photos (capture times from 2024); after that the phone backed up each photo shortly after it was
// taken, and scripts/reference-history.cjs adds the account's history across 2025 and 2026 (edits,
// albums filled over time, links, views and saves, removal requests, trash and purges, the activity
// log). Nothing other than taken_at is dated before 2025-01-01. `--check` fails if any output differs.
//   node scripts/build-reference-fixture.cjs [--check]
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {draw, hash} = require('../dev/draw-images.cjs');
const {zoneOffset} = require('../src/common.cjs');
const root = path.resolve(__dirname, '..');
const ZONE = 'America/Los_Angeles', ACCOUNT = 'fernshelf-maya', GB = 1e9;
const CLOCK = require('../fixtures/clock.json').initial_time;

// ---- helpers ------------------------------------------------------------------------------------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20261122);
// A second stream for the dates and history added for 2025, so the records drawn from R (IDs,
// sizes, captions, albums, trash) stay exactly as they were.
const SEED_HISTORY = 20250104, R2 = rng(SEED_HISTORY);
const between2 = (lo, hi) => lo + Math.floor(R2() * (hi - lo + 1));
const pick = list => list[Math.floor(R() * list.length)];
const between = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
// A local wall time in the account zone ("2026-11-14T16:41:10") as a timestamp with its offset.
function local(wall) {
  const [d, t] = wall.split('T'), [y, mo, da] = d.split('-').map(Number), [h, mi, s] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi, s || 0);
  let utc = guess - zoneOffset(guess, ZONE);
  utc = guess - zoneOffset(utc, ZONE);
  return fromUtc(utc);
}
function fromUtc(utc) {
  const off = zoneOffset(utc, ZONE) / 60000, sign = off < 0 ? '-' : '+', a = Math.abs(off);
  return new Date(utc + off * 60000).toISOString().slice(0, 19) + sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
}
const plus = (ts, seconds) => fromUtc(Date.parse(ts) + seconds * 1000);
const days = (ts, n) => plus(ts, n * 86400);
const sha = s => 'sha256:' + crypto.createHash('sha256').update('fernshelf-reference:' + s).digest('hex');
const H = (at, action, extra = {}) => ({at, action, actor: 'seed', request_id: null, event_id: null, ...extra});
const before = (a, b) => Date.parse(a) < Date.parse(b);

// ---- people, labels, places ---------------------------------------------------------------------
const people = [['person-dana', 'Dana Ilvesmaa'], ['person-kofi', 'Kofi Darrow'], ['person-omar', 'Omar Sandquist'], ['person-ruth', 'Ruth Fenwick'],
  ['person-theo', 'Theo Fenwick'], ['person-iris', 'Iris Valcourt'], ['person-sam', 'Sam Ardell'], ['person-june', 'June Halloway'],
  ['person-nico', 'Nico Brannigan'], ['person-lena', 'Lena Corvi'], ['person-priya', 'Priya Lowell']].map(([person_id, display_name]) => ({person_id, display_name}));
const labels = [['pl-maya', 'Maya', 'person-maya'], ['pl-dana', 'Dana', 'person-dana'], ['pl-kofi', 'Kofi', 'person-kofi'], ['pl-omar', 'Omar', 'person-omar'],
  ['pl-ruth', 'Mum', 'person-ruth'], ['pl-theo', 'Theo', 'person-theo'], ['pl-iris', 'Iris', 'person-iris'], ['pl-sam', 'Sam', 'person-sam'],
  ['pl-june', 'June', 'person-june'], ['pl-nico', 'Nico', 'person-nico'], ['pl-pip', 'Pip (dog)', null], ['pl-walt', 'Grandpa Walt', null]]
  .map(([id, name, person_id]) => ({id, name, person_id}));
// 30 fictional places (dev/places.cjs): [label, scene kind for the stand-in image]; no coordinates.
const PLACES = require('../dev/places.cjs').PLACES;
const place = k => (k === null ? null : {label: PLACES[k][0], lat: null, lon: null});
const PLACE = Object.fromEntries(PLACES.map((p, k) => [p[0], k]));

// ---- items --------------------------------------------------------------------------------------
const items = [];
const OPENED = local('2025-01-04T10:00:00'), BEFORE_HISTORY = local('2026-01-03T10:00:00');
let importSeq = 0;
function addItem(o) {
  const it = {id: o.id, kind: o.kind || 'photo', taken_at: o.taken_at, added_at: o.added_at, place: o.place ?? null, people: o.people || [], caption: o.caption ?? null,
    source: o.source || 'camera', favorite: !!o.favorite, archived: !!o.archived, backed_up: true, declared_bytes: o.bytes, content_hash: o.hash || sha(o.id),
    width: o.width || 4032, height: o.height || 3024, duration_ms: o.duration_ms ?? null, file: null, state: 'active', trashed_at: null, purge_at: null, purged_at: null,
    saved_from: null, removal_history: [], history: [H(o.added_at, 'added')]};
  items.push(it);
  return it;
}
// Photos taken before the account was opened were backed up in the phone's first sync on opening
// day, one a second; later ones between one and ninety minutes after they were taken.
const addedFor = taken => {
  if (before(taken, OPENED)) { const at = plus(OPENED, 600 + importSeq++); return {added_at: at, importedAt: at}; }
  if (before(taken, BEFORE_HISTORY)) return {added_at: plus(taken, between2(60, 5400))};
  return {added_at: plus(taken, between(60, 5400))};
};
const photoBytes = () => between(2400000, 7800000);
const SPECIAL = {};
function special(id, wall, o) {
  const taken = local(wall), it = addItem({id, taken_at: taken, added_at: o.added_at || plus(taken, 3600), bytes: o.bytes || photoBytes(), ...o});
  SPECIAL[id] = it;
  return it;
}
// The reunion on 14 November 2026 and the rest of November with Dana (exactly 7 search rows).
const alder = place(PLACE['Wrenfield Grange Hall']), reunionAdded = local('2026-11-14T18:02:00');
special('it-2611-0931', '2026-11-14T16:41:10', {place: alder, people: ['pl-dana', 'pl-maya'], caption: 'Everyone on the hall steps', bytes: 4812300, added_at: reunionAdded});
special('it-2611-0932', '2026-11-14T16:41:11', {place: alder, people: ['pl-dana', 'pl-maya'], bytes: 4798000, added_at: reunionAdded});
special('it-2611-0933', '2026-11-14T16:41:12', {place: alder, people: ['pl-dana', 'pl-maya'], bytes: 4805500, added_at: reunionAdded});
special('it-2611-0934', '2026-11-14T17:02:00', {place: alder, people: ['pl-dana', 'pl-kofi'], caption: 'Dana and Kofi by the window', bytes: 5120400, added_at: reunionAdded});
special('it-2611-0935', '2026-11-14T17:10:00', {place: alder, people: ['pl-kofi', 'pl-omar', 'pl-theo'], caption: 'The old team photo, redone', bytes: 5032100, added_at: reunionAdded});
special('it-2611-0936', '2026-11-14T17:15:00', {place: alder, people: ['pl-ruth', 'pl-theo'], bytes: 3987000, added_at: reunionAdded});
special('it-2611-0937', '2026-11-14T17:30:00', {kind: 'video', place: alder, people: ['pl-kofi', 'pl-omar', 'pl-ruth'], caption: 'Speeches', bytes: 182000000, width: 1920, height: 1080, duration_ms: 214000, added_at: reunionAdded});
special('it-2611-0940', '2026-11-14T17:45:00', {place: alder, people: ['pl-dana', 'pl-iris'], caption: 'Dana and Iris at the cake table', bytes: 5240000, added_at: reunionAdded});
special('it-2611-0941', '2026-11-14T17:45:00', {place: alder, people: ['pl-dana', 'pl-iris'], caption: 'Dana and Iris at the cake table (warmer)', bytes: 5310000, added_at: local('2026-11-15T21:10:00')});
special('it-2611-0942', '2026-11-14T17:45:00', {place: alder, people: ['pl-dana', 'pl-iris'], caption: 'Dana and Iris at the cake table (cropped)', bytes: 4410000, favorite: true, added_at: local('2026-11-16T07:40:00')});
special('it-2611-0943', '2026-11-14T17:50:00', {place: alder, people: ['pl-maya', 'pl-ruth'], caption: 'Mum and me', bytes: 4120000, favorite: true, added_at: reunionAdded});
special('it-2610-0949', '2026-10-31T23:30:00', {place: place(PLACE['Lanternby Square']), people: ['pl-dana', 'pl-maya'], caption: 'Lantern walk, just before midnight', bytes: 3650000});
special('it-2611-0950', '2026-11-03T08:15:00', {place: place(PLACE['Kettlewhistle cafe']), people: ['pl-dana'], caption: 'Coffee before work', bytes: 2890000});
special('it-2611-0952', '2026-11-08T11:20:00', {place: place(PLACE['Larchcombe Ridge trailhead']), people: ['pl-dana', 'pl-sam'], bytes: 6120000});
special('it-2611-0955', '2026-11-18T19:30:00', {place: place(PLACE['Millwhistle bakery']), people: ['pl-dana', 'pl-maya', 'pl-theo'], caption: 'Dana\'s birthday dinner', bytes: 3980000});
special('it-2611-0957', '2026-11-19T08:05:00', {place: null, people: ['pl-dana'], bytes: 2750000});
special('it-2611-0958', '2026-11-19T08:05:02', {place: null, people: ['pl-dana'], bytes: 2700000});
special('it-2611-0960', '2026-11-01T16:20:00', {place: place(PLACE['Hawcombe Avenue']), people: [], caption: 'Gift for Mum: the blue scarf', bytes: 3300000});

// Procedural outings across three years of capture time.
const OUTING_PEOPLE = [['pl-maya'], ['pl-ruth'], ['pl-theo'], ['pl-pip'], ['pl-maya', 'pl-pip'], ['pl-sam', 'pl-maya'], ['pl-iris'], ['pl-nico'],
  ['pl-ruth', 'pl-walt'], ['pl-kofi'], ['pl-omar'], ['pl-june'], ['pl-dana'], [], [], []];
const CAPTIONS = ['First light', 'Picnic blanket', 'Muddy boots', 'Fog lifting', 'Sunday market haul', 'Pip found a stick', 'Rain on the window', 'Golden hour',
  'Too many tomatoes', 'Trail snack break', 'Lanterns', 'Sled race', 'New shelves', 'The long way home', 'Kite day', 'Mum\'s dahlias', 'Grandpa Walt\'s chair'];
const outings = [];
for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  if (y === 2026 && m > 10) break;
  for (let k = 0; k < 2; k++) {
    const day = between(1, 27), hour = between(8, 18);
    outings.push({wall: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00`, place: 1 + (outings.length % 29), people: pick(OUTING_PEOPLE)});
  }
}
// The August cabin trip and the spring recital are dated outings used by albums.
outings.push({wall: '2026-08-15T10:00:00', place: PLACE['Hobbleford cabin'], people: ['pl-sam', 'pl-june', 'pl-maya'], cabin: true});
outings.push({wall: '2026-08-16T09:30:00', place: PLACE['Glimmerwell Lake'], people: ['pl-sam', 'pl-june'], cabin: true});
outings.push({wall: '2026-04-18T18:00:00', place: PLACE['Maplewick school hall'], people: ['pl-theo'], recital: true});
outings.push({wall: '2026-04-26T10:00:00', place: PLACE['Tamsin Row garden'], people: ['pl-ruth'], garden: true});
outings.push({wall: '2026-06-07T09:00:00', place: PLACE['Thimble Lane community garden'], people: ['pl-nico', 'pl-maya'], garden: true});
outings.push({wall: '2025-12-27T13:00:00', place: PLACE['Grandpa Walt\'s porch'], people: ['pl-ruth', 'pl-walt'], winter: true});
outings.push({wall: '2026-01-02T11:00:00', place: PLACE['Frostcombe sled hill'], people: ['pl-theo', 'pl-maya'], winter: true});
outings.sort((a, b) => (a.wall < b.wall ? -1 : 1));

// Counts: 380 photos and 40 videos in all.
const SPECIAL_PHOTOS = Object.values(SPECIAL).filter(i => i.kind === 'photo').length, SPECIAL_VIDEOS = 1;
const BURSTS = [4, 3, 5, 3, 4, 3, 3], EDITS = [1, 1, 2, 1, 1, 1, 1, 1, 1], DUPLICATES = 8, PAIRS = 6, SCREENSHOTS = 18, DOWNLOADS = 8;
const extras = BURSTS.reduce((n, b) => n + b - 1, 0) + EDITS.reduce((n, e) => n + e, 0) + DUPLICATES + PAIRS;
const BASE_PHOTOS = 380 - SPECIAL_PHOTOS - extras - SCREENSHOTS - DOWNLOADS, VIDEOS = 40 - SPECIAL_VIDEOS;
let seq = 100;
const nextId = taken => { seq++; const d = taken.slice(2, 4) + taken.slice(5, 7); return 'it-' + d + '-' + String(seq).padStart(4, '0'); };
const base = [], videos = [];
for (let k = 0; k < BASE_PHOTOS; k++) {
  const o = outings[k % outings.length], taken = plus(local(o.wall), k * 97 % 5400);
  const it = addItem({id: nextId(taken), taken_at: taken, ...addedFor(taken), place: place(o.place), people: o.people, caption: R() < 0.35 ? pick(CAPTIONS) : null,
    bytes: photoBytes(), favorite: R() < 0.08});
  it.outing = o;
  base.push(it);
}
for (let k = 0; k < VIDEOS; k++) {
  const o = outings[(k * 7 + 3) % outings.length], taken = plus(local(o.wall), 1800 + k);
  const it = addItem({id: nextId(taken), kind: 'video', taken_at: taken, ...addedFor(taken), place: place(o.place), people: o.people, caption: R() < 0.4 ? pick(CAPTIONS) : null,
    bytes: between(60, 520) * 1000000, width: 1920, height: 1080, duration_ms: between(8, 420) * 1000});
  it.outing = o;
  videos.push(it);
}
for (let k = 0; k < SCREENSHOTS; k++) {
  const taken = local(`2026-${String(1 + (k % 10)).padStart(2, '0')}-${String(4 + k).padStart(2, '0')}T${String(9 + (k % 9)).padStart(2, '0')}:12:00`);
  addItem({id: nextId(taken), source: 'screenshot', taken_at: taken, added_at: plus(taken, 20), bytes: between(180000, 900000), width: 1170, height: 2532,
    archived: k % 6 === 0, caption: k % 3 === 0 ? pick(['Ferry timetable', 'Recipe card', 'Boarding pass', 'Seed order', 'Map pin']) : null});
}
for (let k = 0; k < DOWNLOADS; k++) {
  const taken = local(`2025-${String(2 + k).padStart(2, '0')}-11T15:00:00`);
  addItem({id: nextId(taken), source: 'download', taken_at: taken, ...addedFor(taken), bytes: between(400000, 2600000), width: 2000, height: 1400,
    caption: pick(['Trail map', 'Event poster', 'Knitting pattern', 'Bus route'])});
}
const stacks = [];
const stackOf = new Map();
function stack(id, kind, members, cover, created_at) {
  stacks.push({id, kind, cover_id: cover.id, item_ids: members.map(m => m.id), created_at});
  for (const m of members) stackOf.set(m.id, id);
}
stack('st-0188', 'burst', ['it-2611-0931', 'it-2611-0932', 'it-2611-0933'].map(i => SPECIAL[i]), SPECIAL['it-2611-0931'], reunionAdded);
stack('st-0190', 'edit', ['it-2611-0940', 'it-2611-0941', 'it-2611-0942'].map(i => SPECIAL[i]), SPECIAL['it-2611-0942'], SPECIAL['it-2611-0941'].added_at);
// Copies are made from base photos far apart in the list so stacks do not overlap.
const free = base.filter(i => !i.favorite);
let cursor = 0;
const take = () => { const it = free[cursor]; cursor += 7; return it; };
const copyOf = (src, o) => addItem({id: nextId(o.taken_at || src.taken_at), taken_at: src.taken_at, added_at: src.added_at, place: src.place, people: src.people,
  caption: src.caption, bytes: photoBytes(), ...o});
let stackNo = 200;
for (const size of BURSTS) {
  const first = take(), frames = [first];
  for (let k = 1; k < size; k++) frames.push(copyOf(first, {taken_at: plus(first.taken_at, k), added_at: first.added_at, caption: null}));
  stack('st-0' + (stackNo++), 'burst', frames, frames[Math.floor(size / 2)], first.added_at);
}
for (const n of EDITS) {
  const original = take(), versions = [original];
  for (let k = 1; k <= n; k++) versions.push(copyOf(original, {added_at: days(original.added_at, k), caption: (original.caption || 'Edited') + (k === 1 ? ' (edited)' : ' (black and white)')}));
  stack('st-0' + (stackNo++), 'edit', versions, versions[versions.length - 1], versions[1].added_at);
}
const duplicateCopies = [];
for (let k = 0; k < DUPLICATES; k++) {
  const keep = take(), near = copyOf(keep, {taken_at: plus(keep.taken_at, 2), caption: keep.caption});
  duplicateCopies.push(near);
  stack('st-0' + (stackNo++), 'duplicate', [keep, near], keep, near.added_at);
}
const pairCopies = [];
for (let k = 0; k < PAIRS; k++) {
  const original = take();
  const from = before(original.added_at, local('2026-01-04T00:00:00')) ? local('2026-02-01T12:00:00') : original.added_at;
  pairCopies.push(copyOf(original, {source: 'download', added_at: days(from, 3 + k),
    hash: original.content_hash, bytes: original.declared_bytes, caption: original.caption}));
}

// ---- trash: 16 items still in the trash (0.41 GB) and 4 past their retention ----------------------
const RETENTION = 30;
const used = new Set([...stackOf.keys(), ...pairCopies.map(i => i.id)]);
const trashPool = base.filter(i => !used.has(i.id) && !i.favorite && !i.outing.cabin && !i.outing.recital && !i.outing.winter && !i.outing.garden).slice(-60);
function trash(it, at) { Object.assign(it, {state: 'trashed', trashed_at: at, purge_at: days(at, RETENTION)}); it.history.push(H(at, 'trashed')); }
const trashVideo = videos.find(v => !v.outing.cabin && !v.outing.winter && !v.outing.recital);
trashVideo.declared_bytes = 300000000;
trash(trashVideo, local('2026-11-12T21:00:00'));
const trashPhotos = trashPool.filter((_, k) => k % 3 === 0).slice(0, 18);
// 16 still in the trash: the 300 MB video, it-2611-0958 and 14 photos, 0.41 GB in all; 4 past their retention.
const active = trashPhotos.slice(0, 14), past = trashPhotos.slice(14, 18);
// Large originals are what people clear out first.
active.forEach((it, k) => { it.declared_bytes = between(7000000, 8000000); trash(it, plus(local('2026-10-25T20:00:00'), k * 86400 + k * 600)); });
trash(SPECIAL['it-2611-0958'], local('2026-11-19T09:40:00'));
past.forEach((it, k) => trash(it, plus(local('2026-09-20T19:00:00'), k * 5 * 86400)));
const lastTrash = active[active.length - 1];
lastTrash.declared_bytes = 110000000 - active.slice(0, -1).reduce((n, i) => n + i.declared_bytes, 0) - SPECIAL['it-2611-0958'].declared_bytes;
if (lastTrash.declared_bytes < 1000000 || lastTrash.declared_bytes > 12000000) throw Error('Trash balance out of range: ' + lastTrash.declared_bytes);

// ---- albums, members, contributions, links, views ----------------------------------------------
const year = (it, y) => it.taken_at.startsWith(String(y));
const ok = it => it.state === 'active' && it.kind === 'photo';
const albums = [];
function album(id, title, created_at, ids, extra = {}) {
  const a = {id, title, created_at, created_by: 'seed', request_id: null, item_ids: ids.slice(), members: [], contributions: [], deleted_at: null, ...extra};
  albums.push(a);
  return a;
}
const member = (person_id, role, status, invited_at, joined_at = null, ended_at = null) => ({person_id, role, status, invited_at, joined_at, ended_at,
  history: [H(invited_at, 'invited'), ...(joined_at ? [H(joined_at, 'joined')] : []), ...(ended_at ? [H(ended_at, status)] : [])]});
const contrib = (id, person_id, o) => ({id, person_id, kind: 'photo', taken_at: o.taken_at, place: o.place ?? null, people: o.people || [], caption: o.caption ?? null,
  declared_bytes: o.bytes, content_hash: o.hash ?? null, width: 4000, height: 3000, added_at: o.added_at, removed_at: o.removed_at ?? null,
  removed_reason: o.removed_at ? 'member_left' : null, event_id: null});
const S = id => SPECIAL[id];
// Shared: Reunion 2026 (4 joined members).
const reunion = album('al-reunion-2026', 'Reunion 2026', local('2026-11-14T19:00:00'),
  ['it-2611-0931', 'it-2611-0934', 'it-2611-0935', 'it-2611-0936', 'it-2611-0937', 'it-2611-0943']);
reunion.members = [member('person-kofi', 'viewer', 'joined', local('2026-11-14T19:05:00'), local('2026-11-14T19:40:00')),
  member('person-omar', 'contributor', 'joined', local('2026-11-14T19:05:00'), local('2026-11-15T08:10:00')),
  member('person-ruth', 'viewer', 'joined', local('2026-11-14T19:05:00'), local('2026-11-15T09:00:00')),
  member('person-theo', 'contributor', 'joined', local('2026-11-14T19:06:00'), local('2026-11-15T09:30:00'))];
const omarAt = local('2026-11-15T10:30:00'), theoAt = local('2026-11-15T11:00:00');
reunion.contributions = [
  contrib('ct-omar-0004', 'person-omar', {taken_at: local('2026-11-14T16:55:00'), place: alder, people: ['pl-maya', 'pl-kofi'], bytes: 3810000, added_at: omarAt}),
  contrib('ct-omar-0005', 'person-omar', {taken_at: local('2026-11-14T17:01:00'), place: alder, people: ['pl-theo'], caption: 'Theo mid-story', bytes: 3655000, added_at: omarAt}),
  contrib('ct-omar-0006', 'person-omar', {taken_at: local('2026-11-14T17:04:00'), place: alder, people: [], bytes: 3702000, added_at: omarAt}),
  contrib('ct-omar-0007', 'person-omar', {taken_at: local('2026-11-14T17:05:00'), place: alder, people: ['pl-dana'], bytes: 3920000, added_at: omarAt}),
  contrib('ct-theo-0001', 'person-theo', {taken_at: local('2026-11-14T18:10:00'), place: alder, people: ['pl-ruth', 'pl-maya'], caption: 'Walking out', bytes: 4400000, added_at: theoAt}),
  contrib('ct-theo-0002', 'person-theo', {taken_at: local('2026-11-14T18:12:00'), place: alder, people: [], bytes: 4100000, added_at: theoAt})];
reunion.item_ids.push(...reunion.contributions.map(k => k.id));
// Shared: Family 2026 (Mum joined, Iris invited). Holds a duplicate copy that is also in Best of 2026.
const fam2026 = base.filter(i => ok(i) && year(i, 2026) && i.people.includes('pl-ruth') && !used.has(i.id)).slice(0, 8);
const D1 = duplicateCopies[0];
const family = album('al-family-2026', 'Family 2026', local('2026-02-14T10:00:00'), ['it-2611-0934', 'it-2611-0943', D1.id, ...fam2026.map(i => i.id)]);
family.members = [member('person-ruth', 'viewer', 'joined', local('2026-02-14T10:05:00'), local('2026-02-15T08:00:00')),
  member('person-iris', 'viewer', 'invited', local('2026-10-20T19:00:00'))];
// Shared: Cabin trip, August (Sam joined; June left and her contributions left with her); its link was revoked.
const cabinItems = base.filter(i => i.outing.cabin && ok(i) && !used.has(i.id));
const cabin = album('al-cabin-2026', 'Cabin trip, August', local('2026-08-18T20:00:00'), cabinItems.slice(2).map(i => i.id));
cabin.members = [member('person-sam', 'contributor', 'joined', local('2026-08-18T20:05:00'), local('2026-08-18T21:00:00')),
  member('person-june', 'contributor', 'left', local('2026-08-18T20:05:00'), local('2026-08-19T07:30:00'), local('2026-09-01T12:00:00'))];
const samAt = local('2026-08-19T09:00:00');
cabin.contributions = [1, 2, 3, 4].map(n => contrib('ct-sam-000' + n, 'person-sam', {taken_at: local('2026-08-15T1' + n + ':20:00'), place: place(PLACE['Hobbleford cabin']),
  people: n % 2 ? ['pl-maya'] : [], bytes: 3500000 + n * 111000, added_at: samAt}))
  .concat([1, 2].map(n => contrib('ct-june-000' + n, 'person-june', {taken_at: local('2026-08-16T1' + n + ':00:00'), place: place(PLACE['Glimmerwell Lake']),
    people: ['pl-sam'], bytes: 3300000 + n * 97000, added_at: local('2026-08-19T08:00:00'), removed_at: local('2026-09-01T12:00:00')})));
cabin.item_ids.push(...cabin.contributions.filter(k => !k.removed_at).map(k => k.id));
// Shared: Garden swap (Nico joined as contributor).
const gardenItems = base.filter(i => ok(i) && i.outing.garden && !used.has(i.id)).slice(0, 6);
const garden = album('al-garden-swap', 'Garden swap', local('2026-05-02T09:00:00'), gardenItems.map(i => i.id));
garden.members = [member('person-nico', 'contributor', 'joined', local('2026-05-02T09:05:00'), local('2026-05-03T18:00:00'))];
garden.contributions = [1, 2].map(n => contrib('ct-nico-000' + n, 'person-nico', {taken_at: local('2026-05-01T1' + n + ':00:00'), place: place(PLACE['Thimble Lane community garden']),
  people: ['pl-nico'], caption: n === 1 ? 'Seedlings to swap' : null, bytes: 2900000 + n * 50000, added_at: local('2026-05-04T08:00:00')}));
garden.item_ids.push(...garden.contributions.map(k => k.id));
// Private albums.
const best = base.filter(i => ok(i) && year(i, 2026) && i.favorite).slice(0, 9).map(i => i.id);
const bestAlbum = album('al-best-2026', 'Best of 2026', local('2026-03-01T20:00:00'), [...best, D1.id, 'it-2611-0942', 'it-2611-0931', active[3].id]);
const winterItems = base.filter(i => i.outing.winter && ok(i) && !used.has(i.id)).map(i => i.id);
const winter = album('al-winter-visit', 'Winter visit', local('2026-01-04T09:00:00'), [...winterItems, 'it-2611-0960']);
album('al-pip', 'Pip', local('2025-03-02T20:00:00'), base.filter(i => ok(i) && i.people.includes('pl-pip')).slice(0, 14).map(i => i.id));
const recitalItems = base.filter(i => i.outing.recital && ok(i)).map(i => i.id);
album('al-recital-2026', 'Spring recital 2026', local('2026-04-19T09:00:00'), recitalItems);
album('al-2025', '2025 highlights', local('2026-01-06T20:00:00'), base.filter(i => ok(i) && year(i, 2025) && !used.has(i.id)).filter((_, k) => k % 6 === 0).slice(0, 15).map(i => i.id));
album('al-trails', 'Trail days', local('2025-05-03T20:00:00'), base.filter(i => ok(i) && i.place && /Ridge|Meadow|lookout|Lake/.test(i.place.label)).slice(0, 12).map(i => i.id));
album('al-kitchen', 'Kitchen redo', local('2026-03-15T20:00:00'), base.filter(i => ok(i) && i.place && /kitchen|bakery|cafe/i.test(i.place.label)).slice(0, 8).map(i => i.id));
album('al-keep', 'Screenshots to keep', local('2026-02-01T20:00:00'), items.filter(i => i.source === 'screenshot' && i.state === 'active').slice(0, 6).map(i => i.id));
// Links: Reunion (active, expires 31 Dec), Cabin (revoked), recital (expired), winter visit (active, no expiry).
const links = [
  {id: 'ln-0003', album_id: 'al-cabin-2026', created_at: local('2026-08-20T09:00:00'), expires_at: null, revoked_at: local('2026-09-02T08:00:00'), revoke_reason: 'revoked', request_id: null},
  {id: 'ln-0007', album_id: 'al-recital-2026', created_at: local('2026-04-19T09:30:00'), expires_at: local('2026-06-01T00:00:00'), revoked_at: null, revoke_reason: null, request_id: null},
  {id: 'ln-0010', album_id: 'al-winter-visit', created_at: local('2026-02-10T18:00:00'), expires_at: null, revoked_at: null, revoke_reason: null, request_id: null},
  {id: 'ln-0012', album_id: 'al-reunion-2026', created_at: local('2026-11-15T12:00:00'), expires_at: local('2026-12-31T23:59:00'), revoked_at: null, revoke_reason: null, request_id: null}];
const view = (id, at, surface, viewer, viewed, saved = []) => ({id, at, surface, viewer: viewer ? {person_id: viewer, anonymous: false} : {person_id: null, anonymous: true},
  viewed_item_ids: viewed, saved_item_ids: saved, event_id: null, resolved_by_match: false});
const L = (id, album_id) => ({type: 'link', album_id, link_id: id});
const A = album_id => ({type: 'album', album_id, link_id: null});
const cabinShown = cabin.item_ids;
const views = [
  view('vw-0031', local('2026-08-21T19:12:00'), L('ln-0003', 'al-cabin-2026'), null, cabinShown.slice(0, 3), [cabinShown[1]]),
  view('vw-0032', local('2026-08-24T08:40:00'), L('ln-0003', 'al-cabin-2026'), 'person-june', cabinShown.slice(2, 4)),
  view('vw-0071', local('2026-05-20T20:00:00'), L('ln-0007', 'al-recital-2026'), 'person-ruth', recitalItems.slice(0, 2)),
  view('vw-0091', local('2026-11-15T20:14:00'), L('ln-0012', 'al-reunion-2026'), 'person-kofi', ['it-2611-0931', 'it-2611-0934'], ['it-2611-0931']),
  view('vw-0094', local('2026-11-16T08:30:00'), L('ln-0012', 'al-reunion-2026'), null, ['it-2611-0935', 'it-2611-0936', 'ct-omar-0005']),
  view('vw-0095', local('2026-11-17T12:45:00'), L('ln-0012', 'al-reunion-2026'), 'person-priya', ['it-2611-0943', 'it-2611-0936'], ['it-2611-0943']),
  view('vw-0096', local('2026-11-16T10:00:00'), A('al-reunion-2026'), 'person-ruth', ['it-2611-0934', 'it-2611-0935']),
  view('vw-0097', local('2026-11-16T11:00:00'), A('al-reunion-2026'), 'person-omar', ['ct-theo-0001']),
  view('vw-0101', local('2026-02-11T19:00:00'), L('ln-0010', 'al-winter-visit'), 'person-ruth', winterItems.slice(0, 3), [winterItems[0]]),
  view('vw-0102', local('2026-03-02T07:50:00'), L('ln-0010', 'al-winter-visit'), null, winterItems.slice(1, 3)),
  view('vw-0103', local('2026-11-02T21:30:00'), L('ln-0010', 'al-winter-visit'), 'person-theo', winter.item_ids.slice(), ['it-2611-0960'])];
views.sort((a, b) => (a.at < b.at ? -1 : 1));

// ---- removal requests: every state -------------------------------------------------------------
const juneItems = cabinItems.slice(0, 2);
const famHonored = fam2026.length ? base.find(i => ok(i) && year(i, 2025) && !used.has(i.id) && albums.find(a => a.id === 'al-2025').item_ids.includes(i.id)) : null;
const removals = [
  {id: 'rr-0001', from_person_id: 'person-june', item_ids: juneItems.map(i => i.id), not_removable: [], scope: {type: 'album', album_id: 'al-cabin-2026'},
    message: 'Could you take the two of me at the lake out of the cabin album?', requested_at: local('2026-08-24T09:00:00'), event_id: null, state: 'honored',
    answers: [{decision: 'honor', note: 'Done, sorry about that.', at: local('2026-08-24T18:30:00'), request_id: null}],
    cleared: juneItems.map(i => ({item_id: i.id, album_ids: ['al-cabin-2026'], link_ids: ['ln-0003']})), honored_at: local('2026-08-24T18:30:00'), withdrawn_at: null, withdraw_message: null},
  {id: 'rr-0002', from_person_id: 'person-priya', item_ids: [famHonored.id], not_removable: [], scope: {type: 'everywhere', album_id: null},
    message: 'Please keep the one from the market off anything shared.', requested_at: local('2026-04-09T20:10:00'), event_id: null, state: 'honored',
    answers: [{decision: 'honor', note: null, at: local('2026-04-10T08:00:00'), request_id: null}],
    cleared: [{item_id: famHonored.id, album_ids: ['al-family-2026'], link_ids: []}], honored_at: local('2026-04-10T08:00:00'), withdrawn_at: null, withdraw_message: null},
  {id: 'rr-0003', from_person_id: 'person-sam', item_ids: [cabinItems[2].id], not_removable: [], scope: {type: 'album', album_id: 'al-cabin-2026'},
    message: 'Not my best angle!', requested_at: local('2026-09-04T17:00:00'), event_id: null, state: 'declined',
    answers: [{decision: 'decline', note: 'Keeping this one, it is the only picture of the whole group.', at: local('2026-09-05T09:00:00'), request_id: null}],
    cleared: null, honored_at: null, withdrawn_at: null, withdraw_message: null},
  {id: 'rr-0004', from_person_id: 'person-iris', item_ids: [fam2026[0].id], not_removable: [], scope: {type: 'everywhere', album_id: null},
    message: 'Could that one come down?', requested_at: local('2026-10-21T20:00:00'), event_id: null, state: 'withdrawn', answers: [], cleared: null, honored_at: null,
    withdrawn_at: local('2026-10-22T07:15:00'), withdraw_message: 'Never mind, I saw it again and it is fine.'},
  {id: 'rr-0005', from_person_id: 'person-kofi', item_ids: ['it-2611-0935'], not_removable: [], scope: {type: 'album', album_id: 'al-reunion-2026'},
    message: 'Can the team photo come out of the reunion album? I would rather not have it on a link.', requested_at: local('2026-11-18T22:05:00'), event_id: null, state: 'pending',
    answers: [], cleared: null, honored_at: null, withdrawn_at: null, withdraw_message: null},
  {id: 'rr-0006', from_person_id: 'person-lena', item_ids: [winterItems[2]], not_removable: [], scope: {type: 'everywhere', album_id: null},
    message: 'I am in the background of this one; please do not share it.', requested_at: local('2026-11-19T18:40:00'), event_id: null, state: 'pending',
    answers: [], cleared: null, honored_at: null, withdrawn_at: null, withdraw_message: null}];
for (const r of removals.filter(x => x.state === 'honored')) {
  for (const c of r.cleared) {
    const it = items.find(i => i.id === c.item_id);
    it.removal_history.push({removal_id: r.id, person_id: r.from_person_id, album_ids: c.album_ids, at: r.honored_at});
    it.history.push(H(r.honored_at, 'removal_honored', {changes: {albums_cleared: c.album_ids}}));
    for (const a of albums) if (c.album_ids.includes(a.id)) a.item_ids = a.item_ids.filter(id => id !== c.item_id);
  }
}

const need = (cond, what) => { if (!cond) throw Error('Reference fixture: ' + what); };
need(cabinItems.length >= 6 && winterItems.length >= 3 && recitalItems.length >= 2 && fam2026.length >= 4 && gardenItems.length >= 3 && famHonored, 'too few outing items');

// ---- files: 48 script-drawn stand-ins on photos -------------------------------------------------
const withFile = ['it-2611-0931', 'it-2611-0934', 'it-2611-0935', 'it-2611-0936', 'it-2611-0942', 'it-2611-0940', 'it-2611-0943', 'it-2611-0960']
  .map(S).concat([D1, duplicateCopies[1], items.find(i => i.id === stacks.find(s => s.item_ids.includes(D1.id)).cover_id)],
    cabinItems.slice(2, 6), gardenItems.slice(0, 3), base.filter(i => i.outing.winter && ok(i)).slice(0, 3), past.slice(0, 1), active.slice(1, 3));
const fillers = base.filter(i => ok(i) && !withFile.includes(i) && i.place).filter((_, k) => k % 9 === 4);
while (withFile.length < 48) withFile.push(fillers.shift());
need(new Set(withFile).size === 48 && withFile.every(i => i && i.kind === 'photo'), '48 distinct photos with files');
const sceneFor = it => (it.place && PLACE[it.place.label] !== undefined ? PLACES[PLACE[it.place.label]][1] : 'city');
const assets = [], files = {};
for (const it of withFile) {
  const caption = (it.place ? it.place.label.replace(/,.*$/, '') : 'Fernshelf') + ' ' + it.taken_at.slice(0, 10);
  const {captionLines} = require('../dev/draw-images.cjs');
  need(captionLines(caption, 128).join(' ') === caption.toUpperCase().replace(/[^A-Z0-9 .,&-]/g, ' ').split(/\s+/).filter(Boolean).join(' '), 'the stamped caption of ' + it.id + ' fits without cutting a word');
  const img = draw({scene: sceneFor(it), caption, seed: hash(it.id)});
  const name = it.id + '.png', assetId = 'img-' + it.id;
  it.file = assetId;
  files[name] = img.bytes;
  assets.push({schema_version: 'pale.asset-descriptor.v1', asset_id: assetId, scope: {level: 'package', app_id: 'fernshelf'}, roles: ['content.attachment'],
    subjects: [{app_id: 'fernshelf', account_id: ACCOUNT, object_type: 'item', object_id: it.id}], mime_type: 'image/png', availability: {status: 'ready'},
    storage: {adapter: 'storage.file', path: 'assets/' + name, packaging: 'bundled'},
    integrity: {bytes: img.bytes.length, sha256: crypto.createHash('sha256').update(img.bytes).digest('hex')},
    provenance: {dataset_id: 'fernshelf-reference', source_ids: ['drawn']}, publication: 'public', access: {audience: ['agent'], rule: 'parent_object'},
    media: {image: {width: img.width, height: img.height}}, extensions: []});
}
assets.sort((a, b) => (a.asset_id < b.asset_id ? -1 : 1));

// ---- storage: exactly 13.95 GB used of 15 GB --------------------------------------------------------
const QUOTA = 15 * GB, USED = 13.95 * GB;
const isPast = it => it.state === 'purged' || (it.state === 'trashed' && Date.parse(it.purge_at) <= Date.parse(CLOCK));
const counted = () => items.filter(i => i.backed_up && !isPast(i)).reduce((n, i) => n + i.declared_bytes, 0);
const balance = videos.find(v => v.state === 'active' && v !== trashVideo && !Object.values(albums).some(a => a.item_ids.includes(v.id)));
balance.caption = 'Lake swim, the whole afternoon';
balance.declared_bytes += USED - counted();
if (balance.declared_bytes < 500e6 || balance.declared_bytes > 3e9) throw Error('Balance video out of range: ' + balance.declared_bytes);

// ---- history from 2025: edits, 2025 sharing, trash and purges, notifications, activity -------------
for (const it of items) delete it.outing;
const history = require('./reference-history.cjs').extend({items, stacks, albums, links, views, removals, people, base, ACCOUNT, OWNER: 'person-maya', OPENED, CLOCK,
  QUOTA, RETENTION, ZONE, local, plus, days, before, H, R2, between2, fromUtc, photoBytes2: () => between2(2400000, 7800000)});

// ---- assemble -----------------------------------------------------------------------------------
items.sort((a, b) => Date.parse(a.added_at) - Date.parse(b.added_at) || (a.id < b.id ? -1 : 1));
const data = {account_id: ACCOUNT, owner_person_id: 'person-maya',
  account: {display_name: 'Maya Fenwick', plan: 'Fernshelf 15 GB', quota_bytes: QUOTA, trash_retention_days: RETENTION, time_zone: ZONE, email_notices: true, opened_at: OPENED},
  people, labels, items, stacks, albums, links, views, removals, notifications: history.notifications, activity: history.activity};
const records = require('../src/model.cjs').records(data).length;
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'contribution/dataset.json'), 'utf8'));
dataset.expected_counts = {records, assets: assets.length};
const synthetic = (source_id, description, generation) => ({source_id, kind: 'synthetic', description, uri: null, license: 'MIT', usage: 'permitted', collection: null, generation});
dataset.record_source_ids = ['authored', 'procedural', 'history'];
dataset.sources = [
  synthetic('authored', 'Story records written out by hand in scripts/build-reference-fixture.cjs. Items: the November 2026 reunion and the other dated photos. Albums: the four albums shared now, with their members and contributions. Links and views: the four links of 2026 (ln-0003, ln-0007, ln-0010, ln-0012) and the 11 views of 2026 (through a link or by a member), with their 5 saves. Removal requests: the six of 2026, with their messages. People, places and captions are fictional; no external collection.',
    {method: 'manual', tool: 'scripts/build-reference-fixture.cjs', tool_version: '1.1.0', seed: null, parameters: {}}),
  synthetic('procedural', 'The rest of the library generated by scripts/build-reference-fixture.cjs from a fixed seed. Items: outings with capture times from January 2024 to October 2026, screenshots and downloads, sizes and captions. Stacks and exact duplicates. Albums: the private albums and which items each holds. The 2026 trash.',
    {method: 'procedural', tool: 'scripts/build-reference-fixture.cjs', tool_version: '1.1.0', seed: 20261122, parameters: {items: 420, capture_from: '2024-01-01', clock: CLOCK}}),
  synthetic('history', 'The account history from its opening on 2025-01-04 to the fixture clock, generated by scripts/reference-history.cjs from its own fixed seed. Items: arrival times, edits, the cover chosen in each stack, the items trashed and restored in 2025 and the 8 purged records. Albums: creation times of Trail days and Pip and the time each item entered each album. Members: Theo (declined, Trail days) and Ruth (joined and left, Pip). Links and views: the two links of 2025 (ln-0001, ln-0002) and the 5 views of 2025 (through a link or by a member), with their 2 saves. Removal requests: the two of 2025 (rr-0010 honoured, rr-0011 declined). Every notification and the whole activity log.',
    {method: 'procedural', tool: 'scripts/reference-history.cjs', tool_version: '1.1.0', seed: SEED_HISTORY, parameters: {opened_at: OPENED, history_from: '2025-01-01'}}),
  synthetic('drawn', 'Stand-in PNG images drawn by dev/draw-images.cjs: flat scenes of colour fields and shapes with light grain and a stamped caption. No people, faces, photographs or generative model.',
    {method: 'procedural', tool: 'dev/draw-images.cjs', tool_version: '1.1.0', seed: null, parameters: {width: 128, height: 96, seed_from: 'FNV-1a hash of the item ID'}})];
dataset.transformations = ['Timestamps carry explicit UTC offsets; local days are resolved in America/Los_Angeles.',
  'fixtures/reference.json, the images in assets/ and contribution/assets.catalog.json are written by scripts/build-reference-fixture.cjs (with scripts/reference-history.cjs); `--check` confirms they match byte for byte. fixtures/minimal.json is written by hand.'];
const catalog = {schema_version: 'pale.asset-catalog.v1', catalog_id: 'fernshelf-assets', app_id: 'fernshelf', dataset_ref: 'dataset.json', assets, extensions: []};

const outputs = {'fixtures/reference.json': JSON.stringify(data, null, 2) + '\n', 'contribution/assets.catalog.json': JSON.stringify(catalog, null, 2) + '\n',
  'contribution/dataset.json': JSON.stringify(dataset, null, 2) + '\n'};
for (const [name, bytes] of Object.entries(files)) outputs['assets/' + name] = bytes;
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(outputs)) {
    const target = path.join(root, file), bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (check) { if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) drift.push(file); } else fs.writeFileSync(target, bytes);
  }
  // assets/ holds only the files this builder draws; in write mode stale ones from an earlier build are replaced.
  const extra = fs.readdirSync(path.join(root, 'assets')).filter(f => !files[f]);
  if (check) drift.push(...extra.map(f => 'assets/' + f + ' (not built)'));
  else for (const f of extra) if (/^it-[0-9]{4}-[0-9]{4}\.png$/.test(f)) fs.rmSync(path.join(root, 'assets', f));
  return drift;
}
module.exports = {build, data};
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = build({check});
  if (drift.length) { console.error('Reference fixture drift: ' + drift.join(', ')); process.exitCode = 1; }
  else console.log(check ? 'Reference fixture matches its builder.' : 'Reference fixture written: ' + items.length + ' items, ' + assets.length + ' image files.');
}
