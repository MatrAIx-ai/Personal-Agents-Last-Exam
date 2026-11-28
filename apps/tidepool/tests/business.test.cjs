'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const minimal = require('../fixtures/minimal.json');
const binding = require('../fixtures/binding.json');
const scenario = require('../examples/scenario.json');
const solo = require('../examples/task-data/seed.json');
const soloBinding = require('../examples/task-data/binding.json');
const root = path.resolve(__dirname, '..');
const ev = id => JSON.parse(fs.readFileSync(path.join(root, 'examples/events', id + '.json'), 'utf8'));
const soloPaid = require('../examples/task-data/events/leila-november-paid.json');

// Another family member's account: the same family seed bound to that member's Tidepool account.
const as = key => ({...structuredClone(minimal), account_id: 'tidepool-' + key, owner_person_id: 'person-' + key});
const member = key => fixture({seed: as(key)});
const leila = () => fixture({seed: solo, binding: soloBinding});
function unchanged(f, fn, code) {
  const before = f.data;
  assert.throws(fn, error => {assert.equal(error.code, code, error.message); return true;});
  assert.deepEqual(f.data, before);
}
const event = (base, overrides = {}, payload = {}) => {
  const e = structuredClone(typeof base === 'string' ? ev(base) : base);
  Object.assign(e, overrides); Object.assign(e.payload, payload);
  for (const [k, v] of Object.entries(payload)) if (v === undefined) delete e.payload[k];
  return e;
};
const rows = f => f.data.activity.length;
// Status of each item's newest download (an item can have older, removed downloads).
function statuses(f, id = 'mem-priya', args = {}) {
  const out = {};
  for (const d of f.call('tidepool.downloads.list', {id, include_removed: true, ...args}).downloads) if (!(d.item_id in out)) out[d.item_id] = d.status;
  return out;
}
// family.get's per-member counts must agree with downloads.list at the same clock.
function consistent(f, id) {
  const listed = f.call('tidepool.downloads.list', {id}).downloads;
  const counts = f.call('tidepool.family.get', {}).members.find(m => m.member_id === id).downloads;
  const expect = {queued: 0, downloaded: 0, needs_check: 0, bytes: 0};
  for (const d of listed) {expect[d.status]++; expect.bytes += d.bytes;}
  assert.deepEqual(counts, expect, 'family.get and downloads.list agree');
  return counts;
}

// ---------------------------------------------------------------- fixtures and seed rules
test('fixtures: scale, consistency with listening history, clean versions and size', () => {
  assert.equal(minimal.tracks.length, 120); assert.equal(minimal.albums.length, 15); assert.equal(minimal.artists.length, 10);
  assert.equal(minimal.shows.length, 8); assert.equal(minimal.episodes.length, 150);
  assert.equal(minimal.tracks.filter(t => t.clean_version_id).length, 12);
  assert.ok(minimal.sessions.length >= 190 && minimal.sessions.length <= 210);
  assert.equal(minimal.members.length, 4); assert.equal(minimal.devices.length, 6);
  // History starts on or after 2026-01-01 and ends before the fixture clock.
  const clock = Date.parse(require('../fixtures/clock.json').initial_time);
  for (const s of minimal.sessions) assert.ok(Date.parse(s.started_at) >= Date.parse('2026-01-01T00:00:00-08:00') && Date.parse(s.ended_at) <= clock);
  assert.ok(minimal.billing.payments.every(p => p.invoice_id >= 'inv-2026-01'));
  for (const kind of ['smart_speaker', 'earbuds', 'phone', 'car']) assert.ok(minimal.devices.some(d => d.kind === kind));
  for (const reason of ['user', 'autoplay', 'queue', 'voice']) assert.ok(minimal.sessions.some(s => s.start_reason === reason));
  assert.ok(minimal.sessions.some(s => s.end_reason === 'paused'), 'partial sessions');
  // Recompute progress from sessions (latest session wins) and compare with the seeded progress.
  const latest = new Map();
  for (const s of [...minimal.sessions].sort((a, b) => Date.parse(a.ended_at) - Date.parse(b.ended_at))) if (s.item_type === 'episode') latest.set(s.member_id + '/' + s.item_id, s);
  assert.equal(minimal.progress.length, latest.size);
  for (const p of minimal.progress) {
    const s = latest.get(p.member_id + '/' + p.episode_id), e = minimal.episodes.find(x => x.episode_id === p.episode_id);
    const played = s.end_position_s >= e.end_of_content_s;
    assert.equal(p.state, played ? 'played' : 'in_progress'); assert.equal(p.position_s, played ? 0 : s.end_position_s);
  }
  for (const t of minimal.tracks.filter(x => x.clean_version_id)) {
    const clean = minimal.tracks.find(x => x.track_id === t.clean_version_id);
    assert.equal(clean.title, t.title); assert.equal(clean.artist_id, t.artist_id); assert.equal(clean.explicit, false);
  }
  assert.ok(minimal.downloads.filter(d => d.device_id === 'dev-priya-phone').every(d => Date.parse(d.requested_at) < Date.parse('2026-10-31T20:00:00-07:00')),
    'no download reaches Priya\'s phone after its last check-in');
  assert.equal(minimal.devices.find(d => d.device_id === 'dev-priya-phone').storage_cap_bytes, 1e9);
  for (const file of ['fixtures/minimal.json', 'examples/task-data/seed.json']) assert.ok(fs.statSync(path.join(root, file)).size < 1048576, file + ' is under 1 MiB');
  // Dataset counts match plugin.records for both shipped seeds.
  assert.equal(require('../contribution/dataset.json').expected_counts.records, plugin.records(minimal).length);
  assert.equal(require('../examples/task-data/dataset.json').expected_counts.records, plugin.records(solo).length);
  fixture({seed: solo, binding: soloBinding});
});

test('seed validation rejects duplicates, dangling references, overlong sessions, over-full plans and devices, and offset-free times', () => {
  const ctx = {app_id: 'tidepool', binding, virtual_now: '2026-11-24T19:00:00-08:00'};
  const bad = mutate => {const d = structuredClone(minimal); mutate(d); return d;};
  const rejects = (mutate, pattern) => assert.throws(() => plugin.validateSeed(ctx, bad(mutate)), e => e.code === 'invalid_seed' && pattern.test(e.message));
  rejects(d => d.tracks.push({...d.tracks[0]}), /Duplicate catalog ID/);
  rejects(d => {d.episodes[0].episode_id = d.tracks[0].track_id;}, /Duplicate catalog ID/);
  rejects(d => {d.sessions[0].device_id = 'dev-missing';}, /unknown device/);
  rejects(d => {d.sessions[0].member_id = 'mem-noor';}, /signed in/);
  rejects(d => {const s = d.sessions.find(x => x.item_type === 'episode'); s.end_position_s = 99999;}, /within the item/);
  rejects(d => {const s = d.sessions.find(x => x.item_type === 'episode' && x.speed === 1); s.ended_at = s.started_at.replace(/T(\d\d)/, (m, h) => 'T' + h);}, /end after it starts/);
  rejects(d => {d.billing.timeline[0].plan_id = 'duo';}, /more members/);
  rejects(d => {d.downloads.find(x => x.device_id === 'dev-priya-phone' && !x.removed_at).bytes += 1;}, /size differs/);
  rejects(d => {d.devices.find(x => x.device_id === 'dev-priya-phone').storage_cap_bytes = 1000;}, /storage cap/);
  rejects(d => {d.playlists[0].collaborators.push('mem-priya');}, /collaborators/);
  rejects(d => {d.tracks.find(t => t.track_id === 'tr-saltline-07c').title = 'Other';}, /title and artist/);
  rejects(d => {d.members[0].person_id = 'person-nobody';}, /binding/);
  rejects(d => {d.owner_person_id = 'person-ana';}, /binding/);
  rejects(d => {d.billing.payments[0].invoice_id = 'inv-2026-01-04';}, /Unknown invoice/);
  rejects(d => {d.invitations.push({invitation_id: 'i1', person_id: 'person-sam', invited_by: 'mem-priya', invited_at: d.family.created_at, explicit_filter: false, status: 'open', responded_at: null});}, /active member/);
  // Timestamps without a UTC offset fail the seed schema, which Core checks first (invalid_seed).
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
  assert.equal(seedValid(bad(d => {d.sessions[0].started_at = '2026-01-12T17:35:00';})), false);
  // Dates are never compared with the run clock: the fixture validates under a January clock.
  plugin.validateSeed({...ctx, virtual_now: '2026-01-01T00:00:00Z'}, minimal);
});

// ---------------------------------------------------------------- W1 catalog
test('T01 W1: search as Kai marks explicit tracks filtered and returns clean versions; reads never change data', () => {
  const kai = member('kai');
  const found = kai.call('tidepool.catalog.search', {query: 'Saltline', item_type: 'track', limit: 50}).results;
  const explicit = found.filter(t => t.explicit);
  assert.ok(explicit.length >= 4 && explicit.every(t => t.filtered), 'explicit tracks are filtered for Kai');
  for (const t of explicit.filter(x => x.clean_version_id)) {
    const at = found.findIndex(x => x.track_id === t.track_id);
    assert.equal(found[at + 1].track_id, t.clean_version_id, 'clean version follows its explicit track');
    assert.equal(found[at + 1].filtered, false);
  }
  const priya = fixture();
  const forPriya = priya.call('tidepool.catalog.search', {query: 'Saltline', item_type: 'track', limit: 50}).results;
  assert.ok(forPriya.every(t => !t.filtered));
  // Every item type is readable; removed items stay readable in history.
  for (const [id, type] of [['tr-saltline-07', 'track'], ['alb-marrow-2', 'album'], ['art-lowtide', 'artist'], ['show-fieldnotes', 'show'], ['ep-fieldnotes-112', 'episode']]) {
    assert.equal(priya.call('tidepool.catalog.get_item', {item_id: id}).item.item_type, type);
  }
  const ep = priya.call('tidepool.catalog.get_item', {item_id: 'ep-fieldnotes-112'}).item;
  assert.deepEqual([ep.progress, ep.chapters.length >= 3, ep.end_of_content_s < ep.duration_s], [{state: 'in_progress', position_s: 1870}, true, true]);
  assert.equal(priya.call('tidepool.catalog.get_item', {item_id: 'ep-lanternledger-003'}).item.availability, 'removed');
  assert.ok(!priya.call('tidepool.catalog.search', {query: 'bank opened one day'}).results.length, 'search leaves removed items out');
  assert.equal(priya.call('tidepool.shows.get_episodes', {show_id: 'show-harborhours', limit: 1}).episodes[0].episode_id, 'ep-harborhours-088');
  unchanged(priya, () => priya.call('tidepool.catalog.get_item', {item_id: 'tr-missing'}), 'not_found');
  unchanged(priya, () => priya.call('tidepool.shows.get_episodes', {show_id: 'show-missing'}), 'not_found');
});

test('T02 W1: a removed item cannot be queued, saved or downloaded (unavailable), and its downloads end', () => {
  const f = fixture();
  unchanged(f, () => f.call('tidepool.upnext.set', {id: 'mem-priya', episode_ids: ['ep-lanternledger-003'], expected_list_version: 1}), 'unavailable');
  unchanged(f, () => f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: 'ep-lanternledger-003'}), 'unavailable');
  // catalog.update removes a track: saving and downloading it now fail; existing downloads end.
  f.event(event('catalog-remove-staticsignal-071', {event_id: 'remove-marrow-01', at: '2026-11-24T19:10:00-08:00'}, {item_type: 'track', item_id: 'tr-marrow-01'}));
  assert.equal(statuses(f)['tr-marrow-01'], 'removed');
  unchanged(f, () => f.call('tidepool.library.save', {id: 'mem-priya', item_type: 'track', item_id: 'tr-marrow-01'}), 'unavailable');
  unchanged(f, () => f.call('tidepool.playlists.create', {id: 'mem-priya', name: 'x', visibility: 'private', track_ids: ['tr-marrow-01']}), 'unavailable');
  // Changing the explicit flag; a clean version cannot become explicit.
  f.event(event('catalog-remove-staticsignal-071', {event_id: 'flag-juno-04', at: '2026-11-24T19:11:00-08:00'}, {item_type: 'track', item_id: 'tr-juno-04', availability: undefined, explicit: true}));
  assert.equal(f.call('tidepool.catalog.get_item', {item_id: 'tr-juno-04'}).item.explicit, true);
  unchanged(f, () => f.event(event('catalog-remove-staticsignal-071', {event_id: 'flag-clean', at: '2026-11-24T19:12:00-08:00'}, {item_type: 'track', item_id: 'tr-saltline-07c', availability: undefined, explicit: true})), 'invalid_event');
  unchanged(f, () => f.event(event('catalog-remove-staticsignal-071', {event_id: 'nothing', at: '2026-11-24T19:12:00-08:00'}, {availability: undefined})), 'invalid_event');
  unchanged(f, () => f.event(event('catalog-remove-staticsignal-071', {event_id: 'ghost', at: '2026-11-24T19:12:00-08:00'}, {item_id: 'ep-missing'})), 'invalid_event');
  unchanged(f, () => f.event(event('catalog-remove-staticsignal-071', {event_id: 'album-flag', at: '2026-11-24T19:12:00-08:00'}, {item_type: 'album', item_id: 'alb-juno-1', availability: undefined, explicit: true})), 'invalid_event');
  // Removing a show: its episodes cannot be queued or played, though they keep their own availability.
  f.event(event('catalog-remove-staticsignal-071', {event_id: 'remove-kettle', at: '2026-11-24T19:13:00-08:00'}, {item_type: 'show', item_id: 'show-kettletheory'}));
  unchanged(f, () => f.call('tidepool.upnext.set', {id: 'mem-priya', episode_ids: ['ep-kettletheory-052'], expected_list_version: 1}), 'unavailable');
  unchanged(f, () => f.event({event_id: 'kettle-after-removal', at: '2026-11-24T19:20:00-08:00', operation: 'listening.record', payload: {session_id: 'ls-3001',
    member_id: 'mem-priya', device_id: 'dev-kitchen-speaker', item_type: 'episode', item_id: 'ep-kettletheory-052', started_at: '2026-11-24T19:14:00-08:00',
    start_reason: 'voice', speed: 1, start_position_s: 0, end_position_s: 60, end_reason: 'stopped'}}), 'invalid_event');
});

// ---------------------------------------------------------------- W2 listening and progress
test('T03 W2: a kitchen-speaker listening.record updates only Priya; progress.set records set_by agent with the replaced value', () => {
  const f = fixture(), before = f.data;
  f.event(scenario);
  const after = f.data;
  // Exactly one session was appended, under Priya, and only Priya's progress on 113 changed.
  assert.equal(after.sessions.length, before.sessions.length + 1);
  assert.deepEqual(after.sessions.at(-1), {...scenario.payload, ended_at: scenario.at, speaker_hint: null});
  const changed = after.progress.filter(p => JSON.stringify(p) !== JSON.stringify(before.progress.find(q => q.member_id === p.member_id && q.episode_id === p.episode_id)));
  assert.deepEqual(changed.map(p => [p.member_id, p.episode_id, p.state]), [['mem-priya', 'ep-fieldnotes-113', 'played']]);
  assert.deepEqual(after.progress.find(p => p.member_id === 'mem-sam' && p.episode_id === 'ep-fieldnotes-113'),
    before.progress.find(p => p.member_id === 'mem-sam' && p.episode_id === 'ep-fieldnotes-113'));
  // Sam's own account still sees his 600 s position on 113, and no kitchen session in his history.
  const sam = member('sam');
  sam.event(scenario);
  assert.deepEqual(sam.call('tidepool.progress.get', {id: 'mem-sam', episode_ids: ['ep-fieldnotes-113']}).progress[0].position_s, 600);
  assert.ok(!sam.call('tidepool.history.list', {id: 'mem-sam', limit: 200}).sessions.some(s => s.device_id === 'dev-kitchen-speaker'));
  assert.equal(f.call('tidepool.history.list', {id: 'mem-priya', limit: 1}).sessions[0].session_id, 'ls-2207');
  // A speaker hint is stored and shown, never used for authority.
  f.event(ev('kitchen-fieldnotes-114'));
  assert.equal(f.call('tidepool.history.list', {id: 'mem-priya', limit: 1}).sessions[0].speaker_hint, 'Sam');
  assert.deepEqual(f.data.progress.filter(p => p.member_id !== 'mem-priya' && p.episode_id === 'ep-fieldnotes-114'),
    before.progress.filter(p => p.member_id !== 'mem-priya' && p.episode_id === 'ep-fieldnotes-114'), 'no other member\'s progress on 114 changes');
  // W2 acceptance: a session to the end marks 112 played for Priya only; the agent sets it back to 31:10.
  f.event(ev('train-fieldnotes-112-end'));
  assert.equal(f.call('tidepool.progress.get', {id: 'mem-priya', episode_ids: ['ep-fieldnotes-112']}).progress[0].state, 'played');
  const sessions = f.data.sessions.length;
  const set = f.call('tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-fieldnotes-112', state: 'in_progress', position_s: 1870});
  assert.deepEqual([set.state, set.position_s, set.set_by, set.replaced], ['in_progress', 1870, 'agent', {state: 'played', position_s: 0}]);
  const row = f.call('tidepool.progress.get', {id: 'mem-priya', episode_ids: ['ep-fieldnotes-112']}).progress[0];
  assert.deepEqual([row.set_by, row.replaced, row.position_s], ['agent', {state: 'played', position_s: 0}, 1870]);
  assert.equal(f.data.sessions.length, sessions, 'progress.set adds no session');
  assert.deepEqual(f.data.activity.at(-1).replaced, {state: 'played', position_s: 0});
  // Marking unplayed and played; track sessions update play counts.
  assert.equal(f.call('tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-kettletheory-053', state: 'played'}).replaced.state, 'unplayed');
  f.event({event_id: 'kitchen-track', at: '2026-11-25T18:40:00-08:00', operation: 'listening.record', payload: {session_id: 'ls-2211', member_id: 'mem-priya',
    device_id: 'dev-kitchen-speaker', item_type: 'track', item_id: 'tr-marrow-01', started_at: '2026-11-25T18:35:00-08:00', start_reason: 'voice',
    speed: 1, start_position_s: 0, end_position_s: 120, end_reason: 'stopped'}});
  assert.equal(f.call('tidepool.catalog.get_item', {item_id: 'tr-marrow-01'}).item.plays, before.plays.find(p => p.member_id === 'mem-priya' && p.track_id === 'tr-marrow-01').count + 1);
});

test('T04 W2: invalid positions, other members and bad sessions are rejected and change nothing', () => {
  const f = fixture();
  unchanged(f, () => f.call('tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-fieldnotes-112', state: 'in_progress', position_s: 2521}), 'invalid_position');
  unchanged(f, () => f.call('tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-fieldnotes-112', state: 'in_progress'}), 'invalid_position');
  unchanged(f, () => f.call('tidepool.progress.set', {id: 'mem-sam', episode_id: 'ep-fieldnotes-112', state: 'played'}), 'forbidden');
  unchanged(f, () => f.call('tidepool.progress.set', {id: 'mem-ghost', episode_id: 'ep-fieldnotes-112', state: 'played'}), 'not_found');
  unchanged(f, () => f.call('tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-missing', state: 'played'}), 'not_found');
  const at = {at: '2026-11-24T19:42:00-08:00'};
  unchanged(f, () => f.event(event(scenario, at, {end_position_s: 2266})), 'invalid_event');
  unchanged(f, () => f.event(event(scenario, at, {device_id: 'dev-sam-phone'})), 'invalid_event');
  unchanged(f, () => f.event(event(scenario, at, {device_id: 'dev-missing'})), 'invalid_event');
  unchanged(f, () => f.event(event(scenario, at, {member_id: 'mem-ghost'})), 'invalid_event');
  unchanged(f, () => f.event(event(scenario, at, {item_id: 'ep-missing'})), 'invalid_event');
  unchanged(f, () => f.event(event(scenario, at, {item_id: 'ep-lanternledger-003'})), 'invalid_event');
  unchanged(f, () => f.event(event(scenario, at, {started_at: '2026-11-24T19:40:00-08:00'})), 'invalid_event');
  unchanged(f, () => f.event(event(scenario, at, {session_id: minimal.sessions[0].session_id})), 'invalid_event');
  assert.equal(f.ctx.virtual_now, '2026-11-24T19:00:00-08:00', 'failed events roll the clock back');
});

// ---------------------------------------------------------------- W3 follows, Up Next, downloads
test('T05 W3: Up Next is replaced as a whole list with its list version', () => {
  const f = fixture();
  assert.equal(f.call('tidepool.upnext.get', {id: 'mem-priya'}).list_version, 1);
  const set = f.call('tidepool.upnext.set', {id: 'mem-priya', episode_ids: ['ep-fieldnotes-112', 'ep-harborhours-088'], expected_list_version: 1});
  assert.deepEqual([set.list_version, set.episode_ids, set.replaced.length], [2, ['ep-fieldnotes-112', 'ep-harborhours-088'], 5]);
  const q = f.call('tidepool.upnext.get', {id: 'mem-priya'});
  assert.deepEqual(q.entries.map(e => [e.episode_id, e.state, e.position_s]), [['ep-fieldnotes-112', 'in_progress', 1870], ['ep-harborhours-088', 'unplayed', 0]]);
  assert.equal(q.total_remaining_s, (2520 - 1870) + 3120);
  assert.ok(q.total_remaining_s > 40 * 60, 'the queue runs past 40 minutes at 1x');
  unchanged(f, () => f.call('tidepool.upnext.set', {id: 'mem-priya', episode_ids: [], expected_list_version: 1}), 'list_version_mismatch');
  unchanged(f, () => f.call('tidepool.upnext.set', {id: 'mem-priya', episode_ids: ['ep-missing'], expected_list_version: 2}), 'not_found');
  unchanged(f, () => f.call('tidepool.upnext.set', {id: 'mem-sam', episode_ids: [], expected_list_version: 3}), 'forbidden');
  assert.equal(f.call('tidepool.upnext.set', {id: 'mem-priya', episode_ids: [], expected_list_version: 2}).list_version, 3);
});

test('T06 W3: downloads reserve space, complete one simulated minute later, and turn to needs_check after 30 days without a check-in', () => {
  const f = fixture({virtual_now: '2026-11-24T21:00:00-08:00'});
  const startRows = rows(f);
  const free0 = f.call('tidepool.devices.list', {id: 'mem-priya'}).devices.find(d => d.device_id === 'dev-priya-phone').free_bytes;
  assert.ok(Math.abs(free0 - 300e6) < 5e6, 'about 300 MB free');
  const a = f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: 'ep-fieldnotes-112'});
  const b = f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: 'ep-harborhours-088'});
  assert.deepEqual([a.download_status, b.download_status, a.completes_at], ['queued', 'queued', '2026-11-24T21:01:00-08:00']);
  assert.equal(b.free_bytes_after, free0 - 2520 * 16000 - 3120 * 16000, 'bytes are reserved at once');
  assert.equal(f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: 'ep-harborhours-088'}).changed, false);
  assert.equal(rows(f), startRows + 3);
  const queuedCounts = consistent(f, 'mem-priya');
  f.advance('2026-11-24T21:00:59-08:00');
  assert.equal(statuses(f)['ep-harborhours-088'], 'queued');
  f.advance('2026-11-24T21:01:00-08:00');
  assert.deepEqual([statuses(f)['ep-fieldnotes-112'], statuses(f)['ep-harborhours-088']], ['downloaded', 'downloaded']);
  const done = consistent(f, 'mem-priya');
  assert.deepEqual([done.queued, done.downloaded, done.bytes], [0, queuedCounts.downloaded + 2, queuedCounts.bytes]);
  assert.equal(rows(f), startRows + 3, 'completion by time writes no activity row');
  // The phone last checked in Oct. 31 at 20:00 PDT; 30 days later its downloads need a check.
  const device = f.call('tidepool.devices.list', {id: 'mem-priya'}).devices.find(d => d.device_id === 'dev-priya-phone');
  assert.equal(device.offline_check_due_at, '2026-11-30T19:00:00-08:00', 'shown in the clock\'s offset (the check-in was PDT)');
  assert.equal(device.last_checkin_at, '2026-10-31T20:00:00-07:00');
  f.advance('2026-11-30T18:59:59-08:00');
  assert.equal(statuses(f)['ep-harborhours-088'], 'downloaded');
  f.advance('2026-11-30T19:00:00-08:00');
  const listed = f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads;
  assert.ok(listed.filter(d => d.device_id === 'dev-priya-phone').every(d => d.status === 'needs_check' && d.status_reasons.includes('offline_check_overdue')));
  assert.ok(listed.filter(d => d.device_id !== 'dev-priya-phone').every(d => d.status !== 'needs_check'));
  const overdue = consistent(f, 'mem-priya');
  assert.equal(overdue.needs_check, done.downloaded);
  assert.equal(rows(f), startRows + 3, 'the offline check writes no activity row');
  // A check-in refreshes eligibility for another 30 days.
  f.event(event('priya-phone-checkin', {at: '2026-11-30T20:00:00-08:00'}));
  assert.equal(statuses(f)['ep-harborhours-088'], 'downloaded');
  assert.equal(rows(f), startRows + 4);
  unchanged(f, () => f.event(event('priya-phone-checkin', {event_id: 'x', at: '2026-11-30T20:00:00-08:00'}, {device_id: 'dev-missing'})), 'invalid_event');
});

test('T07 W3: storage_full, cancelling a queued download, removal and devices without storage', () => {
  const f = fixture();
  const before = f.call('tidepool.devices.list', {id: 'mem-priya'}).devices.find(d => d.device_id === 'dev-priya-phone').free_bytes;
  // Up Next plus the two saved albums do not fit in 300 MB until played downloads are removed.
  const queue = f.call('tidepool.upnext.get', {id: 'mem-priya'}).entries.map(e => e.episode_id);
  const albums = f.call('tidepool.library.list', {id: 'mem-priya', item_type: 'album'}).items;
  assert.equal(albums.length, 2);
  const needed = queue.reduce((s, id) => s + minimal.episodes.find(e => e.episode_id === id).bytes, 0) + albums.reduce((s, x) => s + x.bytes, 0);
  assert.ok(needed > before, 'queue and albums exceed free space');
  for (const id of queue) f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: id});
  f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id: albums[0].item_id});
  unchanged(f, () => f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id: albums[1].item_id}), 'storage_full');
  // Removing a queued item cancels it and releases its reservation.
  const queued = f.call('tidepool.downloads.list', {id: 'mem-priya', status: 'queued'}).downloads[0];
  const removed = f.call('tidepool.downloads.remove', {id: 'mem-priya', download_id: queued.download_id});
  assert.deepEqual([removed.previous_status, removed.bytes_freed], ['queued', queued.bytes]);
  assert.equal(f.data.downloads.find(d => d.download_id === queued.download_id).removed_reason, 'cancelled');
  // Removing played downloads of unfollowed shows frees enough for both albums.
  const played = f.call('tidepool.downloads.list', {id: 'mem-priya', device_id: 'dev-priya-phone'}).downloads
    .filter(d => d.played && /overtimealmanac|staticsignal/.test(d.item_id));
  assert.equal(played.length, 15);
  let freed = 0;
  for (const d of played) freed += f.call('tidepool.downloads.remove', {id: 'mem-priya', download_id: d.download_id}).bytes_freed;
  assert.equal(freed, played.reduce((s, d) => s + d.bytes, 0));
  assert.equal(f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id: albums[1].item_id}).download_status, 'queued');
  unchanged(f, () => f.call('tidepool.downloads.remove', {id: 'mem-priya', download_id: played[0].download_id}), 'not_found');
  unchanged(f, () => f.call('tidepool.downloads.remove', {id: 'mem-priya', download_id: 'dl-missing'}), 'not_found');
  unchanged(f, () => f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-kitchen-speaker', item_type: 'track', item_id: 'tr-marrow-02'}), 'unavailable');
  unchanged(f, () => f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-sam-phone', item_type: 'track', item_id: 'tr-marrow-02'}), 'forbidden');
  unchanged(f, () => f.call('tidepool.downloads.list', {id: 'mem-sam'}), 'forbidden');
});

test('T07b W3: auto-delete by time alone, follow settings, and unfollow keeps downloads', () => {
  const f = fixture();
  const bytes = id => minimal.episodes.find(e => e.episode_id === id).bytes;
  // The agent downloads 112 for the commute and 110 (played in October); Priya finishes 112 on the train.
  for (const id of ['ep-fieldnotes-112', 'ep-fieldnotes-110']) f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: id});
  f.event(ev('train-fieldnotes-112-end'));
  const list = f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads;
  assert.equal(list.find(d => d.item_id === 'ep-fieldnotes-112').auto_delete_at, '2026-11-27T08:00:00-08:00', 'two days after played');
  assert.equal(list.find(d => d.item_id === 'ep-fieldnotes-110').auto_delete_at, '2026-11-26T19:00:00-08:00', 'two days after downloaded');
  const startRows = rows(f), beforeCounts = consistent(f, 'mem-priya');
  const free = () => f.call('tidepool.devices.list', {id: 'mem-priya'}).devices.find(d => d.device_id === 'dev-priya-phone').free_bytes;
  const freeBefore = free();
  f.advance('2026-11-27T07:59:59-08:00');
  assert.deepEqual([statuses(f)['ep-fieldnotes-110'], statuses(f)['ep-fieldnotes-112']], ['removed', 'downloaded']);
  f.advance('2026-11-27T08:00:00-08:00');
  assert.equal(statuses(f)['ep-fieldnotes-112'], 'removed');
  const afterCounts = consistent(f, 'mem-priya');
  assert.equal(afterCounts.downloaded, beforeCounts.downloaded - 2);
  assert.equal(free() - freeBefore, bytes('ep-fieldnotes-110') + bytes('ep-fieldnotes-112'));
  assert.equal(rows(f), startRows, 'auto-delete by time writes no activity row');
  // The next write records the deletions first (settle), so the freed space is usable by it.
  f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: 'ep-fieldnotes-109'});
  const stored = f.data.downloads.filter(d => d.member_id === 'mem-priya' && ['ep-fieldnotes-110', 'ep-fieldnotes-112'].includes(d.item_id) && d.requested_at.startsWith('2026-11-24'));
  assert.deepEqual(stored.map(d => [d.removed_reason, d.removed_at === d.auto_delete_at]), [['auto_delete', true], ['auto_delete', true]]);
  // Changing auto-delete reschedules pending deletions; unfollowing keeps downloads and cancels them.
  const upd = f.call('tidepool.follows.update_settings', {id: 'mem-priya', show_id: 'show-fieldnotes', patch: {auto_delete_days: 30}});
  assert.deepEqual([upd.replaced, upd.downloads_scheduled_for_auto_delete], [{auto_download_count: 2, auto_delete_days: 2}, 1]);
  const unf = f.call('tidepool.follows.remove', {id: 'mem-priya', show_id: 'show-fieldnotes'});
  assert.equal(unf.downloads_kept, 1);
  f.advance('2027-02-01T00:00:00-08:00');
  assert.equal(statuses(f)['ep-fieldnotes-109'], 'needs_check', 'kept after unfollow (now past its offline check)');
  unchanged(f, () => f.call('tidepool.follows.remove', {id: 'mem-priya', show_id: 'show-fieldnotes'}), 'not_found');
  unchanged(f, () => f.call('tidepool.follows.update_settings', {id: 'mem-priya', show_id: 'show-fieldnotes', patch: {}}), 'not_found');
  assert.equal(f.call('tidepool.follows.add', {id: 'mem-priya', show_id: 'show-fieldnotes', auto_download_count: 2}).changed, true);
  assert.equal(f.call('tidepool.follows.add', {id: 'mem-priya', show_id: 'show-fieldnotes'}).changed, false);
  unchanged(f, () => f.call('tidepool.follows.add', {id: 'mem-sam', show_id: 'show-fieldnotes'}), 'forbidden');
});

test('T07e W3: follows.add with auto-delete applies to already-played downloads; differing settings on an existing follow are refused', () => {
  const f = fixture();
  const oa = () => f.call('tidepool.downloads.list', {id: 'mem-priya', include_removed: true}).downloads.filter(d => /overtimealmanac/.test(d.item_id));
  assert.ok(oa().length === 8 && oa().every(d => d.status === 'downloaded' && d.played));
  const startRows = rows(f);
  const added = f.call('tidepool.follows.add', {id: 'mem-priya', show_id: 'show-overtimealmanac', auto_delete_days: 1});
  assert.deepEqual([added.changed, added.downloads_scheduled_for_auto_delete], [true, 8]);
  // Played months ago, downloaded months ago: the one-day window has passed, so they are due now.
  assert.ok(oa().every(d => d.status === 'removed' && d.status_reasons[0] === 'auto_delete'));
  assert.equal(rows(f), startRows + 1);
  unchanged(f, () => f.call('tidepool.follows.add', {id: 'mem-priya', show_id: 'show-overtimealmanac', auto_delete_days: 3}), 'invalid_arguments');
  unchanged(f, () => f.call('tidepool.follows.add', {id: 'mem-priya', show_id: 'show-overtimealmanac', auto_download_count: 1}), 'invalid_arguments');
  assert.equal(f.call('tidepool.follows.add', {id: 'mem-priya', show_id: 'show-overtimealmanac', auto_delete_days: 1}).changed, false);
  // A new follow of a show with no played downloads schedules nothing.
  assert.equal(f.call('tidepool.follows.add', {id: 'mem-priya', show_id: 'show-loudlibrary', auto_delete_days: 2}).downloads_scheduled_for_auto_delete, 0);
});

test('T07d W3: a fresh download of an already-played episode keeps its full auto-delete window', () => {
  const f = fixture();
  const played = f.call('tidepool.progress.get', {id: 'mem-priya', episode_ids: ['ep-fieldnotes-110']}).progress[0];
  assert.equal(played.state, 'played');
  const d = f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: 'ep-fieldnotes-110'});
  assert.equal(d.download_status, 'queued');
  f.advance('2026-11-24T19:01:00-08:00');
  const row = f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads.find(x => x.download_id === d.download_id);
  assert.deepEqual([row.status, row.auto_delete_at], ['downloaded', '2026-11-26T19:00:00-08:00']);
  // Shortening the window to one day counts from the download, so it is still pending; turning
  // auto-delete off clears it.
  assert.equal(f.call('tidepool.follows.update_settings', {id: 'mem-priya', show_id: 'show-fieldnotes', patch: {auto_delete_days: 1}}).downloads_scheduled_for_auto_delete, 1);
  assert.equal(f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads.find(x => x.download_id === d.download_id).auto_delete_at, '2026-11-25T19:00:00-08:00');
  f.call('tidepool.follows.update_settings', {id: 'mem-priya', show_id: 'show-fieldnotes', patch: {auto_delete_days: null}});
  f.advance('2026-11-27T00:00:00-08:00');
  assert.equal(f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads.find(x => x.download_id === d.download_id).status, 'downloaded');
});

test('T07c W3: episode.publish queues auto-downloads within the newest n, records storage_full, and writes notices', () => {
  const f = fixture();
  f.event(ev('fieldnotes-115-publish'));
  const priya = f.call('tidepool.downloads.list', {id: 'mem-priya', include_removed: true}).downloads;
  assert.equal(priya.find(d => d.item_id === 'ep-fieldnotes-115').status, 'queued');
  assert.deepEqual(priya.filter(d => /fieldnotes/.test(d.item_id) && d.status !== 'removed').map(d => d.item_id), ['ep-fieldnotes-115']);
  const notice = f.call('tidepool.notifications.list', {id: 'mem-priya', limit: 1}).notifications[0];
  assert.deepEqual([notice.kind, notice.object_id, notice.event_id], ['episode_published', 'ep-fieldnotes-115', 'fieldnotes-115-publish']);
  assert.match(notice.text, /Downloading to Priya's phone/);
  // Sam keeps the newest one: 114 is released for 115.
  const sam = f.data.downloads.filter(d => d.member_id === 'mem-sam' && /fieldnotes/.test(d.item_id));
  assert.deepEqual(sam.map(d => [d.item_id, d.removed_reason]), [['ep-fieldnotes-114', 'auto_download_limit'], ['ep-fieldnotes-115', null]]);
  // A full phone records storage_full in the notice and changes no download.
  const g = fixture();
  g.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id: 'alb-lowtide-1'});
  for (const id of ['ep-lanternledger-009', 'ep-lanternledger-010', 'ep-lanternledger-011', 'ep-kettletheory-052', 'ep-kettletheory-053']) g.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: id});
  g.call('tidepool.follows.update_settings', {id: 'mem-priya', show_id: 'show-fieldnotes', patch: {auto_download_count: 3}});
  const beforeDownloads = g.data.downloads.filter(d => d.member_id === 'mem-priya');
  g.event(ev('fieldnotes-115-publish'));
  assert.deepEqual(g.data.downloads.filter(d => d.member_id === 'mem-priya'), beforeDownloads);
  assert.match(g.call('tidepool.notifications.list', {id: 'mem-priya', limit: 1}).notifications[0].text, /Not downloaded to Priya's phone \(storage full\)/);
  unchanged(f, () => f.event(event('fieldnotes-115-publish', {event_id: 'again', at: '2026-11-28T06:00:00-08:00'})), 'invalid_event');
  unchanged(f, () => f.event(event('fieldnotes-115-publish', {event_id: 'p2', at: '2026-11-28T06:00:00-08:00'}, {episode_id: 'ep-fieldnotes-116', show_id: 'show-missing'})), 'invalid_event');
  unchanged(f, () => f.event(event('fieldnotes-115-publish', {event_id: 'p3', at: '2026-11-28T06:00:00-08:00'}, {episode_id: 'ep-fieldnotes-116', end_of_content_s: 9999})), 'invalid_event');
  unchanged(f, () => f.event(event('fieldnotes-115-publish', {event_id: 'p4', at: '2026-11-28T06:00:00-08:00'}, {episode_id: 'ep-fieldnotes-116', published_at: '2026-11-29T05:00:00-08:00'})), 'invalid_event');
});

// ---------------------------------------------------------------- W4 library and playlists
test('T08 W4: a collaborative playlist accepts Noor\'s playlist.edit with her as author; Kai\'s account skips the explicit track', () => {
  const f = fixture(), kai = member('kai'), edit = ev('family-car-noor-add');
  for (const x of [f, kai]) x.event(edit);
  const p = f.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: 'pl-family-car'}).playlist;
  assert.deepEqual([p.track_version, p.tracks[2].track_id, p.tracks[2].added_by, p.tracks.length], [5, 'tr-gutterglow-04', 'mem-noor', 7]);
  assert.equal(p.tracks[2].skipped_for_you, false);
  const forKai = kai.call('tidepool.playlists.get', {id: 'mem-kai', playlist_id: 'pl-family-car'}).playlist;
  assert.deepEqual(forKai.tracks.filter(t => t.skipped_for_you).map(t => t.track_id), ['tr-gutterglow-04'], 'kept, skipped for Kai only');
  assert.equal(forKai.your_role, 'collaborator');
  assert.equal(kai.data.members.find(m => m.member_id === 'mem-kai').explicit_filter, true);
  assert.match(f.call('tidepool.notifications.list', {id: 'mem-priya', limit: 1}).notifications[0].text, /Noor added 1 track in "Family car songs"/);
  // Library: save, save again, unsave; private to the member.
  assert.equal(f.call('tidepool.library.save', {id: 'mem-priya', item_type: 'album', item_id: 'alb-juno-1'}).changed, true);
  assert.equal(f.call('tidepool.library.save', {id: 'mem-priya', item_type: 'album', item_id: 'alb-juno-1'}).changed, false);
  assert.equal(f.call('tidepool.library.list', {id: 'mem-priya'}).items[0].item_id, 'alb-juno-1');
  f.call('tidepool.library.unsave', {id: 'mem-priya', item_type: 'album', item_id: 'alb-juno-1'});
  unchanged(f, () => f.call('tidepool.library.unsave', {id: 'mem-priya', item_type: 'album', item_id: 'alb-juno-1'}), 'not_found');
  unchanged(f, () => f.call('tidepool.library.list', {id: 'mem-noor'}), 'forbidden');
  const kaiLib = kai.call('tidepool.library.list', {id: 'mem-kai', item_type: 'track'}).items;
  assert.ok(kaiLib.every(i => !i.filtered));
});

test('T09 W4: only the owner changes settings; collaborators edit tracks; removed collaborators keep their additions', () => {
  const noor = member('noor');
  unchanged(noor, () => noor.call('tidepool.playlists.update_settings', {id: 'mem-noor', playlist_id: 'pl-family-car', patch: {visibility: 'private'}}), 'forbidden');
  const edit = noor.call('tidepool.playlists.update_tracks', {id: 'mem-noor', playlist_id: 'pl-family-car', operations: [{op: 'add', track_id: 'tr-tamsin-04'}, {op: 'move', track_id: 'tr-tamsin-04', position: 1}]});
  assert.deepEqual([edit.track_version, edit.track_ids[0]], [5, 'tr-tamsin-04']);
  unchanged(noor, () => noor.call('tidepool.playlists.update_tracks', {id: 'mem-noor', playlist_id: 'pl-family-car', operations: [{op: 'add', track_id: 'tr-tamsin-04'}]}), 'invalid_arguments');
  unchanged(noor, () => noor.call('tidepool.playlists.update_tracks', {id: 'mem-noor', playlist_id: 'pl-family-car', operations: [{op: 'remove', track_id: 'tr-juno-09'}]}), 'not_found');
  unchanged(noor, () => noor.call('tidepool.playlists.update_tracks', {id: 'mem-noor', playlist_id: 'pl-family-car', operations: [{op: 'move', track_id: 'tr-tamsin-04', position: 99}]}), 'invalid_position');
  unchanged(noor, () => noor.call('tidepool.playlists.update_tracks', {id: 'mem-noor', playlist_id: 'pl-family-car', expected_track_version: 4, operations: [{op: 'remove', track_id: 'tr-tamsin-04'}]}), 'list_version_mismatch');
  // Sam's shared playlist is visible but read-only to Noor; Priya's private playlist is invisible.
  unchanged(noor, () => noor.call('tidepool.playlists.update_tracks', {id: 'mem-noor', playlist_id: 'pl-road-trip-ideas', operations: [{op: 'remove', track_id: 'tr-kestrel-02'}]}), 'forbidden');
  unchanged(noor, () => noor.call('tidepool.playlists.get', {id: 'mem-noor', playlist_id: 'pl-priya-focus'}), 'not_found');
  assert.deepEqual(noor.call('tidepool.playlists.list', {id: 'mem-noor'}).playlists.map(p => [p.playlist_id, p.your_role]),
    [['pl-family-car', 'collaborator'], ['pl-road-trip-ideas', 'viewer'], ['pl-noor-after-school', 'owner']]);
  // The owner removes Noor as collaborator: her additions stay; she can no longer edit.
  const f = fixture();
  f.event(ev('family-car-noor-add'));
  const s = f.call('tidepool.playlists.update_settings', {id: 'mem-priya', playlist_id: 'pl-family-car', patch: {collaborators: ['mem-sam', 'mem-kai']}});
  assert.deepEqual(s.replaced, {collaborators: ['mem-sam', 'mem-noor', 'mem-kai']});
  assert.equal(f.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: 'pl-family-car'}).playlist.tracks[2].added_by, 'mem-noor');
  unchanged(f, () => f.event(event('family-car-noor-add', {event_id: 'noor-again', at: '2026-11-24T20:00:00-08:00'}, {operations: [{op: 'remove', track_id: 'tr-kestrel-01'}]})), 'not_collaborator');
  unchanged(f, () => f.call('tidepool.playlists.update_settings', {id: 'mem-priya', playlist_id: 'pl-family-car', patch: {collaborators: ['mem-priya']}}), 'invalid_arguments');
  unchanged(f, () => f.call('tidepool.playlists.update_settings', {id: 'mem-priya', playlist_id: 'pl-family-car', patch: {collaborators: ['mem-ghost']}}), 'not_found');
  unchanged(f, () => f.call('tidepool.playlists.update_settings', {id: 'mem-priya', playlist_id: 'pl-family-car', patch: {name: '   '}}), 'invalid_arguments');
});

test('T10 W4: playlist.edit finds an agent-created playlist by owner and name; target_not_found, ambiguous_target and not_collaborator change nothing', () => {
  const f = fixture(), noorAdd = ev('roadtrip-noor-add-1');
  // Before the agent creates "Road trip", the event finds nothing.
  unchanged(f, () => f.event(noorAdd), 'target_not_found');
  assert.equal(f.ctx.virtual_now, '2026-11-24T19:00:00-08:00');
  // The reference plan: Sam's suggestions with clean versions, the track without one left out.
  const ideas = f.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: 'pl-road-trip-ideas'}).playlist.tracks;
  const picks = ideas.filter(t => !t.explicit || t.clean_version_id).map(t => t.explicit ? t.clean_version_id : t.track_id);
  assert.deepEqual(picks, ['tr-kestrel-02', 'tr-tamsin-03', 'tr-saltline-05c', 'tr-copperleaf-08c', 'tr-marrow-04']);
  const created = f.call('tidepool.playlists.create', {id: 'mem-priya', name: 'Road trip', visibility: 'collaborative',
    collaborators: ['mem-sam', 'mem-noor', 'mem-kai'], track_ids: picks});
  assert.deepEqual([created.track_version, created.track_count, created.owner_member_id], [1, 5, 'mem-priya']);
  const beforeRows = rows(f);
  f.event(noorAdd);
  const p = f.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: created.playlist_id}).playlist;
  assert.deepEqual([p.track_version, p.tracks[3].track_id, p.tracks[3].added_by, p.tracks[3].explicit], [2, 'tr-saltline-07', 'mem-noor', true]);
  assert.equal(rows(f), beforeRows + 1);
  const notice = f.call('tidepool.notifications.list', {id: 'mem-priya', limit: 1}).notifications[0];
  assert.deepEqual([notice.kind, notice.object_id], ['playlist_edited', created.playlist_id]);
  // playlist_id names seeded playlists only: the agent-created playlist is reached by playlist_ref.
  unchanged(f, () => f.event(event(noorAdd, {event_id: 'roadtrip-by-id'}, {playlist_ref: undefined, playlist_id: created.playlist_id})), 'target_not_found');
  // The agent swaps Noor's explicit addition for its clean version in place; Kai's filter is unchanged.
  const fix = f.call('tidepool.playlists.update_tracks', {id: 'mem-priya', playlist_id: created.playlist_id, expected_track_version: 2,
    operations: [{op: 'remove', track_id: 'tr-saltline-07'}, {op: 'add', track_id: 'tr-saltline-07c', position: 4}]});
  assert.deepEqual([fix.track_version, fix.track_ids[3]], [3, 'tr-saltline-07c']);
  assert.deepEqual(f.data.activity.at(-1).replaced, ['tr-kestrel-02', 'tr-tamsin-03', 'tr-saltline-05c', 'tr-saltline-07', 'tr-copperleaf-08c', 'tr-marrow-04']);
  // A second playlist whose name differs only in case and spaces makes the reference ambiguous.
  f.call('tidepool.playlists.create', {id: 'mem-priya', name: '  road TRIP ', visibility: 'private'});
  unchanged(f, () => f.event(event(noorAdd, {event_id: 'roadtrip-noor-add-2'})), 'ambiguous_target');
  // An author who is not the owner or a collaborator; Jules is not even a member.
  const g = fixture();
  g.call('tidepool.playlists.create', {id: 'mem-priya', name: 'Road trip', visibility: 'collaborative', collaborators: ['mem-sam']});
  unchanged(g, () => g.event(noorAdd), 'not_collaborator');
  unchanged(g, () => g.event(event(noorAdd, {}, {author_member_id: 'mem-ghost'})), 'invalid_event');
  unchanged(g, () => g.event(event(noorAdd, {}, {playlist_ref: {owner_member_id: 'mem-ghost', name: 'Road trip'}})), 'invalid_event');
  unchanged(g, () => g.event(event(noorAdd, {}, {playlist_ref: undefined, playlist_id: 'pl-missing'})), 'target_not_found');
  unchanged(g, () => g.event(event(noorAdd, {}, {author_member_id: 'mem-sam', operations: [{op: 'add', track_id: 'tr-missing'}]})), 'invalid_event');
  unchanged(g, () => g.event(event(noorAdd, {}, {author_member_id: 'mem-sam', operations: [{op: 'move', track_id: 'tr-kestrel-01', position: 1}]})), 'invalid_event');
  // Position past the end appends; the owner may also edit by event (no notice to themself).
  g.event(event(noorAdd, {}, {author_member_id: 'mem-sam', operations: [{op: 'add', track_id: 'tr-kestrel-03', position: 40}]}));
  assert.deepEqual(g.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: g.data.playlists.at(-1).playlist_id}).playlist.tracks.map(t => t.track_id), ['tr-kestrel-03']);
});

// ---------------------------------------------------------------- W5 family plan and controls
test('T11 W5 billing: periods roll over by time, downgrades apply at period end, payment results and the 7-day grace period', () => {
  const f = fixture();
  f.event(ev('priya-phone-checkin'));
  // Family -> Duo with four members is refused, in the quote and on confirm.
  const q = f.call('tidepool.plan.preview_change', {plan_id: 'duo'}).quote;
  assert.deepEqual([q.change, q.allowed, q.blocked_by, q.members_counted, q.new_limit], ['downgrade', false, 'too_many_members', 4, 2]);
  unchanged(f, () => f.call('tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'duo'}), 'too_many_members');
  unchanged(f, () => f.call('tidepool.plan.revoke_change', {id: 'mem-priya'}), 'no_pending_change');
  // After removing Noor and Kai, the downgrade is scheduled for period end (Dec. 3).
  f.call('tidepool.members.remove', {id: 'mem-noor'}); f.call('tidepool.members.remove', {id: 'mem-kai'});
  const quote = f.call('tidepool.plan.preview_change', {plan_id: 'duo'}).quote;
  const done = f.call('tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'duo'});
  assert.deepEqual([done.change, done.plan_id, done.effective_at, done.scheduled_change, done.next_invoice],
    ['downgrade', 'family', '2026-12-03T00:00:00-08:00', {plan_id: 'duo', effective_at: '2026-12-03T00:00:00-08:00'}, quote.next_invoice]);
  assert.equal(done.next_invoice.amount_cents, 1499);
  unchanged(f, () => f.call('tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'duo'}), 'invalid_arguments'); // already scheduled
  // Choosing Family again keeps Family: the scheduled downgrade is revoked (the quote says so first).
  const keep = f.call('tidepool.plan.preview_change', {plan_id: 'family'}).quote;
  assert.deepEqual([keep.change, keep.allowed, keep.replaces_scheduled_change, keep.next_invoice.amount_cents], ['none', true, {plan_id: 'duo', effective_at: '2026-12-03T00:00:00-08:00'}, 1799]);
  const kept = f.call('tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'family'});
  assert.deepEqual([kept.change, kept.plan_id, kept.scheduled_change, kept.revoked_change, kept.next_invoice], ['none', 'family', null, {plan_id: 'duo', effective_at: '2026-12-03T00:00:00-08:00'}, keep.next_invoice]);
  unchanged(f, () => f.call('tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'family'}), 'invalid_arguments');
  f.call('tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'duo'});
  // Revoke, then schedule again.
  assert.deepEqual(f.call('tidepool.plan.revoke_change', {id: 'mem-priya'}).revoked, {plan_id: 'duo', effective_at: '2026-12-03T00:00:00-08:00'});
  assert.equal(f.call('tidepool.family.get', {}).plan.scheduled_change, null);
  f.call('tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'duo'});
  // While the downgrade is pending, invitations count against Duo's two slots.
  assert.deepEqual(f.call('tidepool.family.get', {}).slots, {limit: 6, active_members: 2, open_invitations: 0, available: 0, limit_after_scheduled_change: 2});
  unchanged(f, () => f.call('tidepool.members.invite', {id: 'person-ana'}), 'too_many_members');
  const startRows = rows(f), before = f.call('tidepool.family.get', {}), dlBefore = consistent(f, 'mem-priya');
  // Period end passes with no event: Duo is in effect, a new period starts, its invoice is pending.
  f.advance('2026-12-03T09:00:00-08:00');
  const after = f.call('tidepool.family.get', {});
  assert.deepEqual([before.plan.plan_id, after.plan.plan_id, after.plan.scheduled_change], ['family', 'duo', null]);
  assert.deepEqual([after.billing.status, after.billing.period_start, after.billing.period_end], ['active', '2026-12-03T00:00:00-08:00', '2027-01-03T00:00:00-08:00']);
  assert.deepEqual([after.billing.current_invoice.invoice_id, after.billing.current_invoice.status, after.billing.current_invoice.amount_cents, after.billing.next_invoice.amount_cents],
    ['inv-2026-12-03', 'pending', 1499, 1499]);
  assert.deepEqual(consistent(f, 'mem-priya'), dlBefore, 'downloads unchanged by the period end');
  assert.equal(rows(f), startRows, 'the period end writes no activity row');
  unchanged(f, () => f.call('tidepool.plan.revoke_change', {id: 'mem-priya'}), 'no_pending_change');
  // A declined charge: payment_due with a 7-day grace period, then downloads need a check.
  f.event(ev('invoice-dec-declined'));
  const due = f.call('tidepool.family.get', {}).billing;
  assert.deepEqual([due.status, due.payment_due.invoice_id, due.payment_due.grace_ends_at, due.payment_due.grace_expired],
    ['payment_due', 'inv-2026-12-03', '2026-12-10T09:00:00-08:00', false]);
  assert.match(f.call('tidepool.notifications.list', {id: 'mem-priya', limit: 1}).notifications[0].text, /\$14\.99.*declined/);
  unchanged(f, () => f.call('tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'family'}), 'payment_due');
  const graceRows = rows(f);
  f.advance('2026-12-10T08:59:59-08:00');
  assert.ok(Object.values(statuses(f)).every(s => s !== 'needs_check'));
  f.advance('2026-12-10T09:00:00-08:00');
  assert.equal(f.call('tidepool.family.get', {}).billing.payment_due.grace_expired, true);
  const listed = f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads;
  assert.ok(listed.length && listed.every(d => d.status === 'needs_check' && d.status_reasons.includes('payment_grace_expired')));
  consistent(f, 'mem-priya');
  assert.equal(rows(f), graceRows, 'the grace period ending writes no activity row');
  unchanged(f, () => f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'track', item_id: 'tr-marrow-02'}), 'payment_due');
  // A check-in does not lift a payment hold; a paid result does.
  f.event(event('priya-phone-checkin', {event_id: 'checkin-2', at: '2026-12-11T08:00:00-08:00'}));
  assert.ok(f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads.every(d => d.status === 'needs_check'));
  f.event(event('invoice-dec-declined', {event_id: 'invoice-dec-paid', at: '2026-12-11T09:00:00-08:00'}, {outcome: 'paid'}));
  assert.equal(f.call('tidepool.family.get', {}).billing.status, 'active');
  assert.ok(f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads.every(d => d.status === 'downloaded'));
  unchanged(f, () => f.event(event('invoice-dec-declined', {event_id: 'pay-again', at: '2026-12-11T10:00:00-08:00'}, {outcome: 'paid'})), 'invalid_event');
  unchanged(f, () => f.event(event('invoice-dec-declined', {event_id: 'pay-future', at: '2026-12-11T10:00:00-08:00'}, {invoice_id: 'inv-2027-01-03'})), 'invalid_event');
  unchanged(f, () => f.event(event('invoice-dec-declined', {event_id: 'pay-unknown', at: '2026-12-11T10:00:00-08:00'}, {invoice_id: 'inv-2026-12-04'})), 'invalid_event');
});

test('T11b W5 billing: an immediate upgrade adds its prorated difference to the next invoice; the quote equals the charge', () => {
  const f = leila();
  const due = f.call('tidepool.family.get', {}).billing;
  assert.deepEqual([due.status, due.payment_due.grace_ends_at, due.payment_due.grace_expired], ['payment_due', '2026-11-27T09:00:00-05:00', false]);
  assert.equal(f.call('tidepool.plan.preview_change', {plan_id: 'duo'}).quote.blocked_by, 'payment_due');
  unchanged(f, () => f.call('tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'duo'}), 'payment_due');
  f.event(soloPaid);
  f.advance('2026-11-28T10:05:00-05:00');
  // Period Nov. 15 - Dec. 15 (30 days); 16 days 13 h 55 min remain: round(400 * 1432500 / 2592000) = 221 cents.
  const quote = f.call('tidepool.plan.preview_change', {plan_id: 'duo'}).quote;
  assert.deepEqual([quote.change, quote.allowed, quote.effective_at, quote.proration_cents, quote.next_invoice.amount_cents],
    ['upgrade', true, '2026-11-28T10:05:00-05:00', 221, 1499 + 221]);
  const up = f.call('tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'duo'});
  assert.deepEqual([up.plan_id, up.proration_cents, up.next_invoice], ['duo', 221, quote.next_invoice]);
  assert.equal(f.call('tidepool.family.get', {}).plan.plan_id, 'duo', 'an upgrade applies at once');
  unchanged(f, () => f.call('tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'duo'}), 'invalid_arguments'); // the plan in effect, nothing scheduled
  // Downgrade back to Individual at period end: the next invoice bills Individual plus the proration.
  const down = f.call('tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'individual'});
  assert.deepEqual([down.effective_at, down.next_invoice.amount_cents], ['2026-12-15T00:00:00-05:00', 1099 + 221]);
  f.advance('2026-12-15T00:00:00-05:00');
  const after = f.call('tidepool.family.get', {});
  assert.deepEqual([after.plan.plan_id, after.billing.current_invoice.amount_cents, after.billing.current_invoice.status,
    after.billing.current_invoice.lines.map(l => l.kind)], ['individual', 1320, 'pending', ['plan', 'upgrade_proration']]);
  assert.equal(after.billing.next_invoice.amount_cents, 1099);
});

test('T12 W5 invitations: invite, already_invited, accept or decline by event, target_not_found, already_member and slots', () => {
  const f = fixture();
  const inv = f.call('tidepool.members.invite', {id: 'person-ana'});
  assert.deepEqual([inv.invitation_status, inv.slots.open_invitations, inv.slots.available], ['open', 1, 1]);
  unchanged(f, () => f.call('tidepool.members.invite', {id: 'person-ana'}), 'already_invited');
  unchanged(f, () => f.call('tidepool.members.invite', {id: 'person-sam'}), 'already_member');
  unchanged(f, () => f.call('tidepool.members.invite', {id: 'person-nobody'}), 'not_found');
  f.call('tidepool.members.invite', {id: 'person-jules'});
  unchanged(f, () => f.call('tidepool.members.invite', {id: 'person-omar'}), 'too_many_members');
  // Declining clears the invitation and frees its slot.
  f.event(ev('invite-ana-decline'));
  assert.equal(f.call('tidepool.family.get', {}).slots.available, 1);
  unchanged(f, () => f.event(event('invite-ana-decline', {event_id: 'ana-late', at: '2026-11-26T20:30:00-08:00'})), 'target_not_found');
  // Invited again; accepting makes her an active member with a predictable member ID.
  f.call('tidepool.members.invite', {id: 'person-ana'});
  f.event(ev('invite-ana-accept'));
  const ana = f.call('tidepool.members.list', {}).members.find(m => m.person_id === 'person-ana');
  assert.deepEqual([ana.member_id, ana.status, ana.display_name], ['mem-ana', 'active', 'Ana Raman']);
  assert.deepEqual(f.call('tidepool.family.get', {}).slots, {limit: 6, active_members: 5, open_invitations: 1, available: 0, limit_after_scheduled_change: null});
  unchanged(f, () => f.call('tidepool.members.invite', {id: 'person-ana'}), 'already_member');
  unchanged(f, () => f.event(event('invite-ana-accept', {event_id: 'nobody', at: '2026-11-27T10:00:00-08:00'}, {invitee_person_id: 'person-omar'})), 'target_not_found');
  // Members cannot invite.
  const sam = member('sam');
  unchanged(sam, () => sam.call('tidepool.members.invite', {id: 'person-ana'}), 'forbidden');
});

test('T13 W5 controls: Sam\'s account changing Kai\'s filter is forbidden; members.remove returns what family.get showed beforehand', () => {
  const sam = member('sam');
  unchanged(sam, () => sam.call('tidepool.filters.update', {id: 'mem-kai', patch: {explicit_filter: false}}), 'forbidden');
  unchanged(sam, () => sam.call('tidepool.members.remove', {id: 'mem-kai'}), 'forbidden');
  unchanged(sam, () => sam.call('tidepool.plan.confirm_change', {id: 'mem-sam', plan_id: 'duo'}), 'forbidden');
  unchanged(sam, () => sam.call('tidepool.plan.revoke_change', {id: 'mem-sam'}), 'forbidden');
  // Membership alone gives no access to another member's history, progress or queue.
  for (const [tool, args] of [['tidepool.history.list', {}], ['tidepool.progress.get', {}], ['tidepool.upnext.get', {}], ['tidepool.devices.list', {}],
    ['tidepool.notifications.list', {}], ['tidepool.follows.list', {}], ['tidepool.playlists.list', {}]]) {
    unchanged(sam, () => sam.call(tool, {id: 'mem-priya', ...args}), 'forbidden');
  }
  assert.equal(sam.call('tidepool.members.list', {}).members.find(m => m.is_you).member_id, 'mem-sam');
  // family.get shows a non-manager only their own download counts and no removal impact.
  const samView = sam.call('tidepool.family.get', {}).members;
  assert.deepEqual(samView.map(m => [m.member_id, m.downloads !== null, m.if_removed !== null]),
    [['mem-priya', false, false], ['mem-sam', true, false], ['mem-noor', false, false], ['mem-kai', false, false]]);
  const f = fixture();
  const kai = f.call('tidepool.filters.update', {id: 'mem-kai', patch: {explicit_filter: false}});
  assert.deepEqual([kai.replaced, kai.explicit_filter, kai.changed], [{explicit_filter: true}, false, true]);
  // Removal counts equal family.get's if_removed beforehand.
  for (const id of ['mem-sam', 'mem-noor']) {
    const shown = f.call('tidepool.family.get', {}).members.find(m => m.member_id === id).if_removed;
    const removed = f.call('tidepool.members.remove', {id});
    assert.deepEqual({downloads_removed: removed.downloads_removed, bytes_freed: removed.bytes_freed, collaborations_ended: removed.collaborations_ended,
      playlist_ids: removed.playlist_ids, owned_playlists_hidden: removed.owned_playlists_hidden, owned_playlist_ids: removed.owned_playlist_ids}, shown);
    assert.ok(shown.downloads_removed > 0 && shown.collaborations_ended === 1 && shown.owned_playlists_hidden === 1, JSON.stringify(shown));
  }
  assert.equal(f.call('tidepool.family.get', {}).members.find(m => m.member_id === 'mem-sam').downloads.bytes, 0);
  assert.deepEqual(f.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: 'pl-family-car'}).playlist.collaborators, ['mem-kai']);
  assert.ok(!f.call('tidepool.playlists.list', {id: 'mem-priya'}).playlists.some(p => p.owner_member_id === 'mem-sam'), 'a removed owner\'s shared playlists leave the family view');
  unchanged(f, () => f.call('tidepool.members.remove', {id: 'mem-priya'}), 'forbidden');
  unchanged(f, () => f.call('tidepool.plan.confirm_change', {id: 'mem-noor', plan_id: 'duo'}), 'forbidden');
  unchanged(f, () => f.call('tidepool.plan.revoke_change', {id: 'mem-kai'}), 'forbidden');
  unchanged(f, () => f.call('tidepool.plan.revoke_change', {id: 'mem-ghost'}), 'not_found');
  unchanged(f, () => f.call('tidepool.members.remove', {id: 'mem-sam'}), 'not_found');
  unchanged(f, () => f.call('tidepool.filters.update', {id: 'mem-sam', patch: {explicit_filter: true}}), 'not_found');
});

// ---------------------------------------------------------------- T14 contracts
test('T14: one activity row per committed write or event, none for failures; every event type is covered; reads change nothing', () => {
  const f = fixture();
  const before = f.data;
  for (const [name, args] of [['tidepool.catalog.search', {query: 'harbor'}], ['tidepool.family.get', {}], ['tidepool.members.list', {}],
    ['tidepool.devices.list', {id: 'mem-priya'}], ['tidepool.history.list', {id: 'mem-priya'}], ['tidepool.progress.get', {id: 'mem-priya'}],
    ['tidepool.follows.list', {id: 'mem-priya'}], ['tidepool.upnext.get', {id: 'mem-priya'}], ['tidepool.downloads.list', {id: 'mem-priya', include_removed: true}],
    ['tidepool.library.list', {id: 'mem-priya'}], ['tidepool.playlists.list', {id: 'mem-priya'}], ['tidepool.playlists.get', {id: 'mem-priya', playlist_id: 'pl-priya-focus'}],
    ['tidepool.notifications.list', {id: 'mem-priya'}], ['tidepool.plan.preview_change', {plan_id: 'individual'}],
    ['tidepool.catalog.get_item', {item_id: 'alb-marrow-2'}], ['tidepool.shows.get_episodes', {show_id: 'show-kettletheory'}]]) f.call(name, args);
  assert.deepEqual(f.data, before);
  // Each committed write or event appends exactly one row carrying its request_id or event_id.
  f.call('tidepool.library.save', {id: 'mem-priya', item_type: 'track', item_id: 'tr-juno-01', request_id: 'save-1'});
  f.event(scenario);
  assert.throws(() => f.call('tidepool.library.unsave', {id: 'mem-priya', item_type: 'track', item_id: 'tr-juno-02'}));
  assert.throws(() => f.event(ev('roadtrip-noor-add-1')));
  assert.deepEqual(f.data.activity.map(r => [r.seq, r.actor, r.action, r.request_id, r.event_id, r.member_id]),
    [[1, 'agent', 'tidepool.library.save', 'save-1', null, 'mem-priya'], [2, 'event', 'listening.record', null, 'kitchen-fieldnotes-113', 'mem-priya']]);
  // Every declared event type has an example that applies.
  const declared = require('../app.json').event_types;
  const examples = fs.readdirSync(path.join(root, 'examples/events')).map(file => ev(file.replace(/\.json$/, '')).operation);
  for (const type of declared) assert.ok(type === scenario.operation || examples.includes(type) || type === 'billing.payment_result', type);
  assert.ok(examples.includes('billing.payment_result'));
  assert.throws(() => plugin.applyEvent({...f.ctx, role: 'infra'}, f.data, {...scenario, operation: 'tidepool.reset'}), e => e.code === 'invalid_event');
});

// ---------------------------------------------------------------- clock cutoff (src/visible.cjs)
const later = (list, key, at) => list.filter(x => Date.parse(x[key]) > Date.parse(at));
test('a seed loaded before its latest record shows only what existed at the clock', () => {
  // Leila's seed runs to Nov. 24. At noon Eastern on Oct. 1, Harbor Hours 86-88 and their downloads, the October and
  // November charges, the declined-payment notice and her Up Next (set Nov. 20) do not exist yet.
  const at = '2026-10-01T12:00:00-04:00', f = fixture({seed: solo, binding: soloBinding, virtual_now: at}), before = f.data, id = 'mem-leila';
  const now = Date.parse(at), shown = list => list.filter(x => Date.parse(x) <= now);
  const hh = f.call('tidepool.shows.get_episodes', {show_id: 'show-harborhours', limit: 100});
  assert.equal(hh.total, shown(solo.episodes.filter(e => e.show_id === 'show-harborhours').map(e => e.published_at)).length);
  assert.equal(hh.show.latest_episode_id, 'ep-harborhours-084');
  assert.equal(f.call('tidepool.catalog.search', {query: 'welders union'}).total, 0, 'Harbor Hours 86 is not searchable yet');
  unchanged(f, () => f.call('tidepool.catalog.get_item', {item_id: 'ep-harborhours-086'}), 'not_found');
  assert.deepEqual(f.call('tidepool.downloads.list', {id, include_removed: true}).downloads.map(d => d.download_id), ['dl-leila-album']);
  const family = f.call('tidepool.family.get', {});
  assert.deepEqual([family.billing.status, family.billing.current_invoice.invoice_id, family.billing.current_invoice.status, family.billing.payment_due],
    ['active', 'inv-2026-09-15', 'paid', null]);
  assert.deepEqual(f.call('tidepool.notifications.list', {id}).notifications, []);
  assert.deepEqual(f.call('tidepool.upnext.get', {id}), {list_version: 1, updated_at: null, total_remaining_s: 0, entries: []});
  const sessions = f.call('tidepool.history.list', {id}).sessions;
  assert.equal(sessions.length, shown(solo.sessions.map(s => s.ended_at)).length);
  assert.ok(f.call('tidepool.progress.get', {id}).progress.every(p => Date.parse(p.updated_at) <= now));
  // Only the latest check-in (Nov. 22) is stored; before it the phone reads as checked in when it last played,
  // at the end of her Sept. 18 session, so the album she downloaded in September is still downloaded.
  assert.equal(f.call('tidepool.devices.list', {id}).devices[0].last_checkin_at, '2026-09-18T12:54:36-04:00');
  assert.equal(f.call('tidepool.downloads.list', {id}).downloads[0].status, 'downloaded');
  // Writes on later records fail not_found and change nothing.
  unchanged(f, () => f.call('tidepool.downloads.remove', {id, download_id: 'dl-leila-086'}), 'not_found');
  unchanged(f, () => f.call('tidepool.progress.set', {id, episode_id: 'ep-harborhours-087', state: 'played'}), 'not_found');
  unchanged(f, () => f.call('tidepool.upnext.set', {id, expected_list_version: 1, episode_ids: ['ep-harborhours-086']}), 'not_found');
  unchanged(f, () => f.call('tidepool.downloads.add', {id, device_id: 'dev-leila-phone', item_type: 'episode', item_id: 'ep-harborhours-088'}), 'not_found');
  assert.deepEqual(f.data, before);
  // Time passing writes nothing; the later records appear because the clock reached them.
  f.advance('2026-11-24T19:00:00-08:00');
  assert.deepEqual(f.data, before);
  assert.equal(f.call('tidepool.downloads.list', {id}).downloads.length, 4);
  assert.equal(f.call('tidepool.family.get', {}).billing.payment_due.invoice_id, 'inv-2026-11-15');
  assert.equal(f.call('tidepool.notifications.list', {id}).notifications.length, 1);
  assert.deepEqual(f.call('tidepool.upnext.get', {id}).entries.map(e => e.episode_id), ['ep-harborhours-087', 'ep-harborhours-088']);
  assert.equal(f.call('tidepool.devices.list', {id}).devices[0].last_checkin_at, solo.devices[0].last_checkin_at);
  // An album exists from the start of its release day (in the billing anchor's offset). On Feb. 1 Saltline Arcade's
  // "Low Ceiling Weather" (Feb. 20) and its tracks are not in Tidepool yet.
  const g = fixture({seed: solo, binding: soloBinding, virtual_now: '2026-02-01T12:00:00-05:00'}), early = g.data;
  unchanged(g, () => g.call('tidepool.catalog.get_item', {item_id: 'alb-saltline-2'}), 'not_found');
  unchanged(g, () => g.call('tidepool.catalog.get_item', {item_id: 'tr-saltline-09'}), 'not_found');
  assert.equal(g.call('tidepool.catalog.search', {query: 'low ceiling weather'}).total, 0);
  assert.equal(g.call('tidepool.catalog.get_item', {item_id: 'art-saltline'}).item.albums.length, 1);
  assert.ok(!g.call('tidepool.catalog.search', {query: 'saltline', item_type: 'track', limit: 50}).results.some(t => t.album_id === 'alb-saltline-2'));
  unchanged(g, () => g.call('tidepool.library.save', {id, item_type: 'album', item_id: 'alb-saltline-2'}), 'not_found');
  unchanged(g, () => g.call('tidepool.downloads.add', {id, device_id: 'dev-leila-phone', item_type: 'track', item_id: 'tr-saltline-09'}), 'not_found');
  unchanged(g, () => g.call('tidepool.playlists.create', {id, name: 'Rainy', visibility: 'private', track_ids: ['tr-saltline-09']}), 'not_found');
  g.advance('2026-02-20T00:00:00-05:00');
  assert.deepEqual(g.data, early);
  assert.equal(g.call('tidepool.catalog.get_item', {item_id: 'alb-saltline-2'}).item.released, '2026-02-20');
  assert.equal(g.call('tidepool.library.save', {id, item_type: 'album', item_id: 'alb-saltline-2'}).changed, true);
});

test('at a mid-2026 clock a device that played recently reads as checked in then and keeps its downloads', () => {
  // On June 15 every stored check-in is later (October and November). Priya's phone last played on June 11 and
  // Sam's car on June 11, so neither is 30 days without a check-in and their downloads read downloaded.
  const at = '2026-06-15T12:00:00-07:00', f = fixture({virtual_now: at}), before = f.data;
  const phone = f.call('tidepool.devices.list', {id: 'mem-priya'}).devices.find(d => d.device_id === 'dev-priya-phone');
  assert.deepEqual([phone.last_checkin_at, phone.offline_check_overdue], ['2026-06-11T13:02:23-07:00', false]);
  const priya = f.call('tidepool.downloads.list', {id: 'mem-priya'}).downloads;
  assert.ok(priya.length >= 5 && priya.every(d => d.status === 'downloaded'));
  const sam = fixture({seed: as('sam'), virtual_now: at});
  assert.equal(sam.call('tidepool.devices.list', {id: 'mem-sam'}).devices.find(d => d.device_id === 'dev-family-car').last_checkin_at, '2026-06-11T17:38:14-07:00');
  assert.deepEqual(statuses(sam, 'mem-sam', {device_id: 'dev-family-car'}), {'alb-copperleaf-2': 'downloaded', 'alb-kestrel-1': 'downloaded'});
  // Nothing is stored for this: the stored check-ins read again once the clock passes them.
  f.advance(require('../fixtures/clock.json').initial_time);
  assert.deepEqual(f.data, before);
  assert.equal(f.call('tidepool.devices.list', {id: 'mem-priya'}).devices.find(d => d.device_id === 'dev-priya-phone').last_checkin_at, '2026-10-31T20:00:00-07:00');
});

test('a write before a seeded later record with the same key replaces it; other later records stay', () => {
  // On Oct. 1 Leila has no Up Next yet (the seed sets one on Nov. 20); the agent's list replaces the later one.
  const f = fixture({seed: solo, binding: soloBinding, virtual_now: '2026-10-01T12:00:00-04:00'}), id = 'mem-leila';
  assert.equal(f.call('tidepool.upnext.set', {id, expected_list_version: 1, episode_ids: ['ep-kettletheory-050']}).list_version, 2);
  assert.deepEqual(f.data.upnext, [{member_id: id, list_version: 2, updated_at: '2026-10-01T12:00:00-04:00', episode_ids: ['ep-kettletheory-050']}]);
  // Saving the album already saved changes nothing; the later downloads, charges and notice are still stored.
  assert.equal(f.call('tidepool.library.save', {id, item_type: 'album', item_id: 'alb-juno-2'}).changed, false);
  assert.equal(f.data.downloads.length, 4);
  assert.equal(f.data.billing.payments.length, solo.billing.payments.length);
  f.advance('2026-11-24T19:00:00-08:00');
  assert.deepEqual(f.call('tidepool.upnext.get', {id}).entries.map(e => e.episode_id), ['ep-kettletheory-050']);
  assert.equal(f.call('tidepool.family.get', {}).billing.payment_due.invoice_id, 'inv-2026-11-15');
});

test('a write that the later family records cannot coexist with drops them and keeps later episodes', () => {
  // On April 1 Priya's phone has room for many albums, but at the fixture clock it holds 702.4 MB of later downloads.
  // While the albums still fit beside them the later records stay; the album that would overfill the phone in the
  // stored future drops the family records dated after April 1 (they described a future without these downloads).
  const at = '2026-04-01T12:00:00-07:00', f = fixture({virtual_now: at});
  const download = album => f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id: album});
  let kept = 0;
  for (const album of minimal.albums.map(a => a.album_id)) {
    assert.equal(download(album).changed, true);
    if (!later(f.data.sessions, 'ended_at', at).length) break;
    kept++;
  }
  assert.ok(kept >= 6 && kept < minimal.albums.length, 'several albums fit beside the later downloads before one does not');
  const data = f.data;
  for (const [list, key] of [[data.sessions, 'ended_at'], [data.downloads, 'requested_at'], [data.playlists, 'created_at'], [data.notifications, 'created_at'],
    [data.library, 'saved_at'], [data.billing.payments, 'at']]) assert.deepEqual(later(list, key, at), []);
  assert.equal(data.episodes.length, minimal.episodes.length, 'later episodes stay');
  // The family is stored as it read on April 1: each device's last check-in is the end of its latest session by
  // then (or its registration), so Priya's phone downloads still read downloaded or queued.
  for (const d of data.devices) {
    const played = minimal.sessions.filter(s => s.device_id === d.device_id && Date.parse(s.ended_at) <= Date.parse(at)).map(s => s.ended_at)
      .sort((x, y) => Date.parse(x) - Date.parse(y)).at(-1);
    assert.equal(d.last_checkin_at, played ?? d.registered_at, d.device_id);
  }
  assert.equal(data.devices.find(d => d.device_id === 'dev-priya-phone').last_checkin_at, '2026-04-01T08:07:40-07:00');
  const phone = f.call('tidepool.downloads.list', {id: 'mem-priya', device_id: 'dev-priya-phone'}).downloads;
  assert.ok(phone.every(d => d.status === 'downloaded' || d.status === 'queued'));
  f.advance('2026-11-24T19:00:00-08:00');
  assert.equal(f.call('tidepool.shows.get_episodes', {show_id: 'show-harborhours', limit: 1}).episodes[0].episode_id, 'ep-harborhours-088');
  assert.equal(f.call('tidepool.downloads.list', {id: 'mem-priya', device_id: 'dev-priya-phone'}).downloads.length, kept + 1 + 5);
});

test('before the account exists every tool returns not_found and family events are refused; catalog events apply', () => {
  const f = fixture({seed: solo, binding: soloBinding, virtual_now: '2026-01-10T12:00:00-05:00'}), id = 'mem-leila';
  unchanged(f, () => f.call('tidepool.catalog.search', {query: 'harbor'}), 'not_found');
  unchanged(f, () => f.call('tidepool.family.get', {}), 'not_found');
  unchanged(f, () => f.call('tidepool.library.save', {id, item_type: 'album', item_id: 'alb-juno-2'}), 'not_found');
  unchanged(f, () => f.event({event_id: 'early-checkin', at: '2026-01-10T13:00:00-05:00', operation: 'device.checkin', payload: {device_id: 'dev-leila-phone'}}), 'invalid_event');
  // Static & Signal 51 is published on Jan. 14, so on Jan. 10 it is not in the catalog yet; Harbor Hours 65 is.
  unchanged(f, () => f.event(event('catalog-remove-staticsignal-071', {at: '2026-01-10T13:00:00-05:00'}, {item_id: 'ep-staticsignal-051'})), 'invalid_event');
  f.event(event('catalog-remove-staticsignal-071', {at: '2026-01-10T13:00:00-05:00'}, {item_id: 'ep-harborhours-065'}));
  assert.equal(f.data.episodes.find(e => e.episode_id === 'ep-harborhours-065').availability, 'removed');
});

test('events count only visible records: playlist positions, newest-n auto-downloads and seeded later IDs', () => {
  // On May 1 "Family car songs" shows Priya's three tracks and Sam's two; Kai adds one on June 21.
  const f = fixture({virtual_now: '2026-05-01T12:00:00-07:00'});
  const tracks = () => f.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: 'pl-family-car'}).playlist.tracks.map(t => t.track_id);
  assert.deepEqual(tracks(), ['tr-kestrel-01', 'tr-marrow-02', 'tr-tamsin-01', 'tr-halcyon-03', 'tr-kestrel-05']);
  f.event(event('family-car-noor-add', {at: '2026-05-01T18:00:00-07:00'}, {operations: [{op: 'add', track_id: 'tr-gutterglow-04c', position: 6}]}));
  assert.deepEqual(tracks(), ['tr-kestrel-01', 'tr-marrow-02', 'tr-tamsin-01', 'tr-halcyon-03', 'tr-kestrel-05', 'tr-gutterglow-04c']);
  // The edit replaces the playlist record as a whole, so Kai's later addition is no longer part of it.
  f.advance('2026-11-24T19:00:00-08:00');
  assert.ok(!tracks().includes('tr-juno-02'));
  // Publishing an ID the seed holds for a later episode is refused, as for any existing catalog ID.
  const g = fixture({virtual_now: '2026-11-01T12:00:00-08:00'});
  unchanged(g, () => g.event(event('fieldnotes-115-publish', {at: '2026-11-01T12:00:00-08:00'}, {episode_id: 'ep-fieldnotes-112', number: 112,
    published_at: '2026-11-01T12:00:00-08:00'})), 'invalid_event');
  // Noor auto-downloads the two newest Loud Library episodes. On Oct. 20 the newest she can see are 31 and the new one,
  // so 31 stays; 32 (Nov. 13) does not count before it exists.
  const noor = fixture({seed: as('noor'), virtual_now: '2026-10-20T12:00:00-07:00'});
  noor.event(event('fieldnotes-115-publish', {event_id: 'loudlibrary-099', at: '2026-10-20T12:00:00-07:00'}, {episode_id: 'ep-loudlibrary-099',
    show_id: 'show-loudlibrary', number: 99, published_at: '2026-10-20T12:00:00-07:00', explicit: true}));
  // 31 is not released (auto_download_limit). The phone last played on Oct. 7, so its downloads read downloaded.
  assert.deepEqual(statuses(noor, 'mem-noor', {device_id: 'dev-noor-phone'}),
    {'ep-loudlibrary-099': 'queued', 'ep-loudlibrary-031': 'downloaded', 'alb-gutterglow-2': 'downloaded'});
});

// ---------------------------------------------------------------- evaluation dataset (data/evaluation, dev/build-dataset.cjs)
const evalSeed = require('../data/evaluation/seed.json'), evalBinding = require('../data/evaluation/binding.json');
const evalMeta = require('../data/evaluation/dataset.json'), evalClock = require('../data/evaluation/clock.json').initial_time;
const evalAs = key => ({...structuredClone(evalSeed), account_id: 'tidepool-' + key, owner_person_id: 'person-' + key});
const ACCOUNT_START = '2025-01-03T00:00:00-08:00';

test('the evaluation dataset matches its dataset.json and keeps every fixture record except the three its 2025 story extends', () => {
  const file = path.join(root, 'data/evaluation/seed.json');
  assert.equal(evalMeta.expected_counts.records, plugin.records(evalSeed).length);
  const output = evalMeta.sources.find(x => x.source_id === 'generated').generation.parameters.outputs['seed.json'];
  assert.deepEqual(output, {bytes: fs.statSync(file).size, sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  // dataset.json is a valid bundle dataset, so a task can pass it to env.load_seed unchanged.
  assert.ok(compile(require('../schemas/dataset.schema.json'), path.join(root, 'schemas'))(evalMeta), 'dataset.json matches schemas/dataset.schema.json');
  assert.ok(Buffer.byteLength(JSON.stringify(evalSeed)) < 1.5e6, 'one env.load_seed request');
  assert.equal(evalClock, require('../fixtures/clock.json').initial_time);
  const keys = {members: x => x.member_id, invitations: x => x.invitation_id, plans: x => x.plan_id, artists: x => x.artist_id, albums: x => x.album_id,
    tracks: x => x.track_id, shows: x => x.show_id, episodes: x => x.episode_id, devices: x => x.device_id, sessions: x => x.session_id,
    progress: x => x.member_id + '/' + x.episode_id, plays: x => x.member_id + '/' + x.track_id, follows: x => x.member_id + '/' + x.show_id,
    upnext: x => x.member_id, downloads: x => x.download_id, library: x => x.member_id + '/' + x.item_id, playlists: x => x.playlist_id,
    notifications: x => x.notice_id};
  const changed = [];
  for (const [name, key] of Object.entries(keys)) {
    const stored = new Map(evalSeed[name].map(x => [key(x), JSON.stringify(x)]));
    for (const x of minimal[name]) if (stored.get(key(x)) !== JSON.stringify(x)) changed.push(name + ':' + key(x));
  }
  assert.deepEqual(changed, ['members:mem-priya']);
  assert.deepEqual(evalSeed.members[0], {...minimal.members[0], joined_at: ACCOUNT_START});
  assert.deepEqual(evalSeed.family, {...minimal.family, created_at: ACCOUNT_START});
  assert.deepEqual({...evalSeed.billing, anchor: null, timeline: null, payments: null}, {...minimal.billing, anchor: null, timeline: null, payments: null});
  assert.equal(evalSeed.billing.anchor, ACCOUNT_START);
  assert.deepEqual(evalSeed.billing.timeline, [{plan_id: 'individual', from: ACCOUNT_START, set_at: ACCOUNT_START, change: 'start'},
    {...minimal.billing.timeline[0], change: 'upgrade'}]);
  for (const p of minimal.billing.payments) assert.ok(evalSeed.billing.payments.some(x => JSON.stringify(x) === JSON.stringify(p)));
  for (const k of ['account_id', 'owner_person_id', 'activity', 'next_seq']) assert.deepEqual(evalSeed[k], minimal[k]);
  // State that only changes during the family's 2026 (follows, Up Next, downloads, library, playlists) is the fixture's.
  for (const k of ['invitations', 'follows', 'upnext', 'downloads', 'library', 'playlists']) assert.deepEqual(evalSeed[k], minimal[k], k);
  // Family records end at the dataset clock; only episodes run on to Dec. 31, and Field Notes stops at 114 so its example publish applies.
  const clock = Date.parse(evalClock);
  for (const s of evalSeed.sessions) assert.ok(Date.parse(s.ended_at) <= clock);
  assert.ok(evalSeed.billing.payments.every(p => Date.parse(p.at) <= clock) && evalSeed.notifications.every(n => Date.parse(n.created_at) <= clock));
  assert.ok(!evalSeed.episodes.some(e => e.show_id === 'show-fieldnotes' && e.number > 114));
  // Nothing is played, saved, downloaded or added to a playlist before its album's release day starts (00:00 -08:00).
  const release = new Map(evalSeed.albums.map(x => [x.album_id, Date.parse(x.released + 'T00:00:00-08:00')]));
  const albumOf = (type, id) => type === 'album' ? id : type === 'track' ? evalSeed.tracks.find(x => x.track_id === id).album_id : null;
  for (const [type, id, at] of [...evalSeed.sessions.map(x => [x.item_type, x.item_id, x.started_at]), ...evalSeed.library.map(x => [x.item_type, x.item_id, x.saved_at]),
    ...evalSeed.downloads.map(x => [x.item_type, x.item_id, x.requested_at]), ...evalSeed.playlists.flatMap(p => p.tracks.map(x => ['track', x.track_id, x.added_at]))]) {
    const album = albumOf(type, id);
    if (album) assert.ok(Date.parse(at) >= release.get(album), id + ' at ' + at + ' is after its release');
  }
  const f = fixture({seed: evalSeed, binding: evalBinding, logging: false});
  f.event(ev('fieldnotes-115-publish'));
  assert.ok(f.data.downloads.some(d => d.item_id === 'ep-fieldnotes-115' && d.device_id === 'dev-sam-phone'));
});

test('at the dataset clock the fixture facts read the same for Priya and Sam', () => {
  const priyaJoined = r => {for (const m of r.members ?? []) if (m.member_id === 'mem-priya') m.joined_at = minimal.members[0].joined_at; return r;};
  for (const key of ['priya', 'sam']) {
    const a = fixture({seed: as(key), logging: false}), b = fixture({seed: evalAs(key), binding: evalBinding, logging: false}), id = 'mem-' + key;
    const same = (name, args, shape = r => r) => assert.deepEqual(shape(b.call(name, args)), shape(a.call(name, args)), key + ' ' + name);
    same('tidepool.family.get', {}, priyaJoined);
    same('tidepool.members.list', {}, priyaJoined);
    same('tidepool.plan.preview_change', {plan_id: 'duo'});
    for (const name of ['tidepool.upnext.get', 'tidepool.library.list', 'tidepool.playlists.list']) same(name, {id});
    same('tidepool.downloads.list', {id}, r => ({...r, devices: r.devices.filter(d => d.device_id !== 'dev-priya-oldphone')}));
    same('tidepool.playlists.get', {id, playlist_id: 'pl-family-car'});
    same('tidepool.progress.get', {id, episode_ids: ['ep-fieldnotes-112', 'ep-fieldnotes-113', 'ep-harborhours-088', 'ep-kettletheory-053']});
    same('tidepool.follows.list', {id}, r => r.follows.map(({unplayed_count, ...rest}) => rest));
    same('tidepool.history.list', {id, since: '2026-01-01T00:00:00-08:00', limit: 200});
    same('tidepool.catalog.get_item', {item_id: 'ep-fieldnotes-112'});
  }
  // Priya's account also lists the old phone she streamed on in 2025, and her history and notices run back to 2025.
  const p = fixture({seed: evalSeed, binding: evalBinding, logging: false});
  assert.deepEqual(p.call('tidepool.devices.list', {id: 'mem-priya'}).devices.map(d => d.device_id),
    ['dev-priya-oldphone', 'dev-priya-phone', 'dev-priya-earbuds', 'dev-kitchen-speaker']);
  assert.equal(p.call('tidepool.history.list', {id: 'mem-priya', until: '2025-12-31T23:59:59-08:00'}).total,
    evalSeed.sessions.filter(s => s.started_at < '2026').length);
});

test('the evaluation dataset loads at any clock in its window and shows nothing dated later', () => {
  const sessionsOf = (at, member) => evalSeed.sessions.filter(s => s.member_id === member && Date.parse(s.ended_at) <= Date.parse(at));
  for (const [at, plan, members] of [['2025-03-15T12:00:00-07:00', 'individual', 1], ['2025-12-31T23:59:00-08:00', 'individual', 1],
    [evalClock, 'family', 4], ['2026-12-31T23:59:00-08:00', 'family', 4]]) {
    const f = fixture({seed: evalSeed, binding: evalBinding, virtual_now: at, logging: false}), before = f.data, now = Date.parse(at), id = 'mem-priya';
    for (const show of evalSeed.shows) {
      const r = f.call('tidepool.shows.get_episodes', {show_id: show.show_id, limit: 200});
      assert.equal(r.total, evalSeed.episodes.filter(e => e.show_id === show.show_id && Date.parse(e.published_at) <= now).length, show.show_id + ' at ' + at);
      assert.ok(r.episodes.every(e => Date.parse(e.published_at) <= now));
    }
    const next = evalSeed.episodes.filter(e => Date.parse(e.published_at) > now).sort((x, y) => Date.parse(x.published_at) - Date.parse(y.published_at))[0];
    if (next) unchanged(f, () => f.call('tidepool.catalog.get_item', {item_id: next.episode_id}), 'not_found');
    const history = f.call('tidepool.history.list', {id, limit: 200});
    assert.equal(history.total, sessionsOf(at, id).length, 'sessions at ' + at);
    assert.ok(history.sessions.every(s => Date.parse(s.ended_at) <= now));
    assert.ok(f.call('tidepool.progress.get', {id}).progress.every(p => Date.parse(p.updated_at) <= now));
    assert.ok(f.call('tidepool.downloads.list', {id, include_removed: true}).downloads.every(d => Date.parse(d.requested_at) <= now));
    assert.ok(f.call('tidepool.notifications.list', {id, limit: 200}).notifications.every(n => Date.parse(n.created_at) <= now));
    assert.ok(f.call('tidepool.devices.list', {id}).devices.every(d => Date.parse(d.last_checkin_at) <= now));
    const family = f.call('tidepool.family.get', {});
    assert.deepEqual([family.plan.plan_id, family.members.length], [plan, members], 'family at ' + at);
    assert.equal(family.billing.payment_due, null);
    assert.deepEqual(f.data, before, 'reads change nothing');
  }
  // Sam joins on Jan. 3, 2026: his account has no Tidepool membership before then.
  const sam = fixture({seed: evalAs('sam'), binding: evalBinding, virtual_now: '2025-06-01T12:00:00-07:00', logging: false});
  unchanged(sam, () => sam.call('tidepool.family.get', {}), 'not_found');
  // Priya's declined July 2025 charge was paid two days later; the notice stays.
  const july = fixture({seed: evalSeed, binding: evalBinding, virtual_now: '2025-07-04T12:00:00-07:00', logging: false});
  assert.equal(july.call('tidepool.family.get', {}).billing.payment_due.invoice_id, 'inv-2025-07-03');
  july.advance('2025-07-06T12:00:00-07:00');
  assert.equal(july.call('tidepool.family.get', {}).billing.payment_due, null);
});

// ---- Later history removed by a change at an earlier clock ----------------------------------------
// Independent of src/visible.cjs: a stored record counts as later history at `at` when it records a time
// after the clock. The change's activity row must hold exactly the later records that it removed or
// altered, as they were stored, and the receipt must count them by family (and name none).
const FAMILIES = {
  members: [d => d.members, m => m.member_id], invitations: [d => d.invitations, i => i.invitation_id], devices: [d => d.devices, x => x.device_id],
  sessions: [d => d.sessions, s => s.session_id], progress: [d => d.progress, p => p.member_id + '/' + p.episode_id],
  plays: [d => d.plays, p => p.member_id + '/' + p.track_id], follows: [d => d.follows, x => x.member_id + '/' + x.show_id],
  upnext: [d => d.upnext, u => u.member_id], downloads: [d => d.downloads, x => x.download_id],
  library: [d => d.library, l => l.member_id + '/' + l.item_type + '/' + l.item_id], playlists: [d => d.playlists, p => p.playlist_id],
  notifications: [d => d.notifications, n => n.notice_id], 'billing.adjustments': [d => d.billing.adjustments, a => a.adjustment_id],
  'billing.payments': [d => d.billing.payments, p => p.invoice_id + '|' + p.outcome + '|' + p.at],
};
function laterReport(before, after, receipt, at) {
  const t = Date.parse(at), later = x => (JSON.stringify(x).match(/"\d{4}-\d\d-\d\dT[^"]+"/g) || []).some(s => Date.parse(JSON.parse(s)) > t);
  const expected = {}, stored = {};
  for (const [name, [list, key]] of Object.entries(FAMILIES)) {
    const kept = new Set(list(after).map(x => JSON.stringify(x))), gone = list(before).filter(x => !kept.has(JSON.stringify(x)) && later(x));
    if (gone.length) {expected[name] = gone.map(key); stored[name] = gone;}
  }
  const counts = Object.fromEntries(Object.entries(expected).map(([family, ids]) => [family, ids.length]));
  assert.deepEqual(receipt.later_history_removed ?? {}, counts, 'the receipt counts exactly the later records removed or changed');
  const row = after.activity.at(-1);
  assert.deepEqual(row.later_history_removed ?? {}, stored, 'the activity row keeps them as stored');
  return expected;
}

test('a write at an early clock that drops later family records reports each one in its receipt and activity row', () => {
  // The #216 review's repro: the full dataset loaded at 2026-04-01 and albums added to Priya's phone.
  // The ninth no longer fits beside the later stored downloads, so the later family history is dropped.
  const at = '2026-04-01T12:00:00-07:00', f = fixture({seed: evalSeed, binding: evalBinding, virtual_now: at, logging: false});
  const albums = evalSeed.albums.filter(a => Date.parse(a.released + 'T12:00:00Z') <= Date.parse(at)).map(a => a.album_id).slice(0, 9);
  assert.equal(albums[8], 'alb-copperleaf-1');
  let before, receipt;
  for (const [i, item_id] of albums.entries()) {
    before = f.data;
    receipt = f.call('tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id});
    if (i < 8) assert.equal(receipt.later_history_removed, null, item_id + ' keeps the later records');
  }
  const after = f.data, lost = laterReport(before, after, receipt, at);
  assert.deepEqual([lost.sessions.length, lost.playlists.length, lost['billing.payments'].length], [143, 4, 8]);
  assert.deepEqual([before.sessions.length, after.sessions.length], [321, 178]);
  // Priya's history at the dataset clock is short by exactly the reported sessions.
  const priyaLost = after.activity.at(-1).later_history_removed.sessions.filter(s => s.member_id === 'mem-priya' && Date.parse(s.ended_at) <= Date.parse(evalClock)).length;
  f.advance(evalClock);
  assert.deepEqual([f.call('tidepool.history.list', {id: 'mem-priya', limit: 1}).total, priyaLost], [242 - priyaLost, 85]);
});

test('every kind of early-clock collision reports the later record it replaced, and a plain write reports nothing', () => {
  const at = '2026-04-01T12:00:00-07:00', run = (name, args) => {
    const f = fixture({seed: evalSeed, binding: evalBinding, virtual_now: at, logging: false}), before = f.data;
    const receipt = f.call(name, typeof args === 'function' ? args(f) : args);
    return {lost: laterReport(before, f.data, receipt, at), receipt};
  };
  // A later stored progress row, follow and Up Next list are replaced by the agent's change at the clock.
  assert.deepEqual(run('tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-harborhours-071', state: 'played'}).lost,
    {progress: ['mem-priya/ep-harborhours-071']});
  assert.deepEqual(run('tidepool.follows.add', {id: 'mem-priya', show_id: 'show-fieldnotes'}).lost.follows, ['mem-priya/show-fieldnotes']);
  const upnext = run('tidepool.upnext.set', f => ({id: 'mem-priya', episode_ids: [], expected_list_version: f.call('tidepool.upnext.get', {id: 'mem-priya'}).list_version}));
  assert.deepEqual(upnext.lost.upnext, ['mem-priya']);
  // A write that touches no later record keeps them all and reports null.
  assert.equal(run('tidepool.library.save', {id: 'mem-priya', item_type: 'album', item_id: 'alb-kestrel-1'}).receipt.later_history_removed, null);
});
