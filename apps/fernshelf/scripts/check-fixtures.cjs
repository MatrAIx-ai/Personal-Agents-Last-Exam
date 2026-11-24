#!/usr/bin/env node
'use strict';
// Consistency checks for fixtures/minimal.json and fixtures/reference.json beyond validateSeed:
// purge_at against the retention, storage against the rule, honoured requests against the albums
// as they stand, dates (only taken_at may be before 2026-01-01; nothing after the fixture clock
// except due times), image files against the catalogue (hash, size, PNG dimensions, no duplicates),
// wire messages against Mail's schema, places (invented names, no coordinates) and the reference
// counts promised by the plan.
//   node scripts/check-fixtures.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const {compile} = require('../tests/schema-validator.cjs');
const plugin = require('../plugin.cjs');
const d = require('../src/derive.cjs'), {localDate} = require('../src/common.cjs'), {wireId} = require('../src/notify.cjs');
const binding = require('../fixtures/binding.json');
const catalog = require('../contribution/assets.catalog.json'), dataset = require('../contribution/dataset.json');
const CLOCK = require('../fixtures/clock.json').initial_time;
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
const wireValid = compile(require('../schemas/router-message.schema.json'), path.join(root, 'schemas'));
const FICTIONAL = new Set(require('../dev/places.cjs').PLACES.map(x => x[0]));
const DUE = new Set(['purge_at', 'expires_at']);
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function check(name, data, problems) {
  const p = msg => problems.push(name + ': ' + msg);
  if (!seedValid(data)) return p('seed schema');
  try { plugin.validateSeed({app_id: 'fernshelf', run_id: 'check', role: 'infra', binding, virtual_now: CLOCK}, data); } catch (e) { return p(e.message); }
  const t = Date.parse(CLOCK), zone = data.account.time_zone, retention = data.account.trash_retention_days;
  // Dates: only capture times before 2026; nothing after the clock except due times.
  (function walk(v, key, where) {
    if (typeof v === 'string' && TS.test(v)) {
      if (key !== 'taken_at' && localDate(v, zone) < '2026-01-01') p(where + '.' + key + ' is dated before 2026-01-01: ' + v);
      if (!DUE.has(key) && Date.parse(v) > t) p(where + '.' + key + ' is after the fixture clock: ' + v);
    } else if (Array.isArray(v)) v.forEach((x, k) => walk(x, key, where + '[' + k + ']'));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'wire') walk(x, k, where);
  })(data, '', '');
  // Places: only the invented names of dev/places.cjs, never coordinates.
  const places = [...data.items.map(i => i.place), ...data.albums.flatMap(al => al.contributions.map(k => k.place))].filter(Boolean);
  for (const pl of places) if (!FICTIONAL.has(pl.label) || pl.lat !== null || pl.lon !== null) p('place ' + JSON.stringify(pl) + ' is not one of the fictional places without coordinates');
  for (const i of data.items) {
    if (i.state === 'trashed' && Date.parse(i.purge_at) - Date.parse(i.trashed_at) !== retention * 86400000) p(i.id + ': purge_at is not trashed_at + ' + retention + ' days');
  }
  // Storage follows the rule: backed-up items that are active or trashed and not yet past purge_at.
  const s = d.storage(data, t), sum = data.items.filter(i => i.backed_up && d.itemState(i, t) !== 'purged').reduce((n, i) => n + i.declared_bytes, 0);
  if (s.used_bytes !== sum) p('used_bytes ' + s.used_bytes + ' differs from the rule ' + sum);
  // Honoured requests match the albums as they stand: a cleared item is not back in a cleared album.
  for (const r of data.removals.filter(x => x.state === 'honored')) for (const c of r.cleared) for (const a of c.album_ids) {
    if (data.albums.find(x => x.id === a).item_ids.includes(c.item_id)) p(r.id + ': ' + c.item_id + ' is back in ' + a);
  }
  for (const n of data.notifications) if (data.account.email_notices ? !n.wire || !wireValid(n.wire) || n.wire.id !== wireId(n) : n.wire !== null) p(n.id + ': wire message does not match email_notices');
  return s;
}

function checkImages(data, problems) {
  const p = msg => problems.push('assets: ' + msg);
  const files = new Map(data.items.filter(i => i.file).map(i => [i.file, i]));
  const hashes = new Set();
  let total = 0;
  for (const a of catalog.assets) {
    const owner = files.get(a.asset_id), subject = a.subjects[0];
    if (!owner || subject.object_id !== owner.id || subject.object_type !== 'item' || subject.account_id !== data.account_id) p(a.asset_id + ' is not the file of its subject item');
    const bytes = fs.readFileSync(path.join(root, a.storage.path));
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha !== a.integrity.sha256 || bytes.length !== a.integrity.bytes) p(a.asset_id + ' hash or size differs from the catalogue');
    if (bytes.length > 16 * 1024) p(a.asset_id + ' is larger than 16 KB');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== a.media.image.width || bytes.readUInt32BE(20) !== a.media.image.height) p(a.asset_id + ' is not a PNG of the catalogued size');
    if (hashes.has(sha)) p(a.asset_id + ' duplicates another file');
    hashes.add(sha);
    total += bytes.length;
  }
  for (const id of files.keys()) if (!catalog.assets.some(a => a.asset_id === id)) p(id + ' is referenced by an item but not catalogued');
  const onDisk = fs.readdirSync(path.join(root, 'assets'));
  if (onDisk.length !== catalog.assets.length) p(onDisk.length + ' files on disk, ' + catalog.assets.length + ' catalogued');
  if (dataset.expected_counts.assets !== catalog.assets.length || dataset.expected_counts.records !== plugin.records(data).length) p('dataset expected_counts do not match');
  return total;
}

function referenceCounts(data, s, problems) {
  const p = msg => problems.push('reference: ' + msg);
  const t = Date.parse(CLOCK), count = f => data.items.filter(f).length;
  const kinds = k => data.stacks.filter(x => x.kind === k).length;
  const hashes = {};
  for (const i of data.items) hashes[i.content_hash] = (hashes[i.content_hash] || 0) + 1;
  const states = new Set(data.removals.map(r => r.state));
  const expect = {
    items: [data.items.length, 420], photos: [count(i => i.kind === 'photo'), 380], videos: [count(i => i.kind === 'video'), 40], files: [count(i => i.file), 48],
    labels: [data.labels.length, 12], places: [new Set(data.items.filter(i => i.place).map(i => i.place.label)).size, 30],
    edit_stacks: [kinds('edit'), 10], burst_stacks: [kinds('burst'), 8], duplicate_stacks: [kinds('duplicate'), 8],
    exact_duplicate_pairs: [Object.values(hashes).filter(n => n === 2).length, 6], albums: [data.albums.length, 12],
    shared_albums: [data.albums.filter(a => d.albumState(a) === 'shared').length, 4], members: [data.albums.reduce((n, a) => n + a.members.length, 0), 9],
    contributions: [data.albums.reduce((n, a) => n + a.contributions.length, 0), 14], links: [data.links.length, 4], views: [data.views.length, 11],
    saves: [data.views.reduce((n, v) => n + v.saved_item_ids.length, 0), 5], removal_requests: [data.removals.length, 6], removal_states: [states.size, 4],
    in_trash: [count(i => i.state === 'trashed'), 20], past_retention: [count(i => i.state === 'trashed' && d.itemState(i, t) === 'purged'), 4],
    notifications: [data.notifications.length, 18], quota: [data.account.quota_bytes, 15e9], used_bytes: [s.used_bytes, 13.95e9], trash_bytes: [s.trash_bytes, 0.41e9],
    pending_bytes: [s.pending_bytes, 0]
  };
  for (const [k, [actual, wanted]] of Object.entries(expect)) if (actual !== wanted) p(k + ' is ' + actual + ', expected ' + wanted);
  if (data.items.some(i => i.taken_at < '2024-01-01')) p('capture times should span 2024 to 2026');
}

function run() {
  const problems = [];
  check('minimal', require('../fixtures/minimal.json'), problems);
  const reference = require('../fixtures/reference.json');
  const s = check('reference', reference, problems);
  if (s) referenceCounts(reference, s, problems);
  const bytes = checkImages(reference, problems);
  return {problems, image_bytes: bytes};
}
module.exports = {run};
if (require.main === module) {
  const {problems, image_bytes} = run();
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log('minimal.json and reference.json: no problems; ' + catalog.assets.length + ' image files, ' + image_bytes + ' bytes.');
}
