#!/usr/bin/env node
'use strict';
// Consistency checks for fixtures/minimal.json and fixtures/reference.json beyond validateSeed,
// applied to every record of both fixtures: purge_at against the retention, storage against the
// rule, honoured requests against the albums as they stand, dates (only taken_at may be before
// 2025-01-01 or before the account was opened; nothing after the fixture clock except due times),
// the history as of each date (item histories, member and contribution times, link windows for
// views, removal answers, storage over time and the 80% notification), image files against the
// catalogue (hash, size, PNG dimensions, no duplicates), wire messages against Mail's schema,
// places (invented names, no coordinates) and the reference counts. A fixture that carries an
// activity log (the reference does) must also have one row, at the right time, for everything its
// records say happened, and one notification for each event that writes one.
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
const FLOOR = '2025-01-01';
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function check(name, data, problems) {
  const p = msg => problems.push(name + ': ' + msg);
  if (!seedValid(data)) return p('seed schema');
  try { plugin.validateSeed({app_id: 'fernshelf', run_id: 'check', role: 'infra', binding, virtual_now: CLOCK}, data); } catch (e) { return p(e.message); }
  const t = Date.parse(CLOCK), zone = data.account.time_zone, retention = data.account.trash_retention_days;
  // Dates: only capture times before 2025 or before the account was opened; nothing after the
  // clock except due times.
  const opened = Date.parse(data.account.opened_at);
  (function walk(v, key, where) {
    if (typeof v === 'string' && TS.test(v)) {
      if (key !== 'taken_at' && localDate(v, zone) < FLOOR) p(where + '.' + key + ' is dated before ' + FLOOR + ': ' + v);
      if (key !== 'taken_at' && Date.parse(v) < opened) p(where + '.' + key + ' is before the account was opened: ' + v);
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
  history(data, t, p);
  for (const n of data.notifications) if (data.account.email_notices ? !n.wire || !wireValid(n.wire) || n.wire.id !== wireId(n) : n.wire !== null) p(n.id + ': wire message does not match email_notices');
  return s;
}

// The history as of each date. `t` is the fixture clock.
function history(data, t, p) {
  const ms = Date.parse, items = new Map(data.items.map(i => [i.id, i])), albums = new Map(data.albums.map(a => [a.id, a]));
  const contributions = new Map(data.albums.flatMap(a => a.contributions.map(k => [k.id, {a, k}])));
  const zone = data.account.time_zone, quota = data.account.quota_bytes;
  // Items: rows in time order, first the arrival, then a valid sequence of states ending in the stored one.
  const trashSpans = new Map();
  for (const i of data.items) {
    const h = i.history, spans = [];
    if (!h.length || h[0].at !== i.added_at || !['imported', 'added', 'added_waiting', 'saved_from_share'].includes(h[0].action)) p(i.id + ': history does not start with its arrival at added_at');
    let state = 'active', since = null, lastPurge = null;
    for (let k = 0; k < h.length; k++) {
      const r = h[k];
      if (k && ms(r.at) < ms(h[k - 1].at)) p(i.id + ': history is not in time order');
      if (ms(r.at) > t) p(i.id + ': history row after the clock');
      if (r.action === 'trashed') { if (state !== 'active') p(i.id + ': trashed while ' + state); state = 'trashed'; since = r.at; }
      else if (r.action === 'restored') { if (state !== 'trashed') p(i.id + ': restored while ' + state); spans.push([ms(since), ms(r.at)]); state = 'active'; }
      else if (r.action === 'purged') { if (state !== 'trashed') p(i.id + ': purged while ' + state); state = 'purged'; lastPurge = r.at; }
      else if (['updated', 'removal_honored'].includes(r.action) && state !== 'active') p(i.id + ': ' + r.action + ' while ' + state);
    }
    if (state !== 'active') spans.push([ms(since), Infinity]);
    trashSpans.set(i.id, spans);
    const stored = i.state === 'trashed' ? 'trashed' : i.state;
    if (stored === 'active' && state !== 'active') p(i.id + ': active but its history ends ' + state);
    if (stored !== 'active' && since !== i.trashed_at) p(i.id + ': trashed_at differs from its last trashed row');
    if (stored === 'trashed' && state !== 'trashed') p(i.id + ': in the trash but its history ends ' + state);
    if (stored === 'purged' && (lastPurge ? lastPurge !== i.purged_at || ms(i.purged_at) >= ms(i.purge_at) : i.purged_at !== i.purge_at)) p(i.id + ': purged_at matches neither a purge row nor the end of its retention');
    for (const r of i.removal_history) if (!h.some(x => x.action === 'removal_honored' && x.at === r.at)) p(i.id + ': removal_history row without its history row');
  }
  const inTrash = (id, at) => (trashSpans.get(id) || []).some(([a, b]) => at >= a && at < b);
  // Members, contributions, links.
  const openAt = (m, at) => ms(m.invited_at) <= at && !(m.ended_at && ms(m.ended_at) <= at);
  for (const a of data.albums) {
    for (const m of a.members) {
      const steps = [m.invited_at, m.joined_at, m.ended_at].filter(Boolean).map(ms);
      if (ms(m.invited_at) < ms(a.created_at) || steps.some((x, k) => k && x < steps[k - 1])) p(a.id + ' ' + m.person_id + ': member times out of order');
      const want = ['invited', ...(m.joined_at ? ['joined'] : []), ...(m.ended_at ? [m.status] : [])];
      if (JSON.stringify(m.history.map(x => x.action)) !== JSON.stringify(want) || m.history[0].at !== m.invited_at) p(a.id + ' ' + m.person_id + ': member history does not match its status');
    }
    for (const k of a.contributions) {
      const m = a.members.find(x => x.person_id === k.person_id);
      if (!m || !m.joined_at || ms(k.added_at) < ms(m.joined_at) || (m.ended_at && ms(k.added_at) >= ms(m.ended_at))) p(k.id + ': contributed when ' + k.person_id + ' was not a joined member');
      if (m && m.role !== 'contributor') p(k.id + ': contributed by a viewer');
      if (k.removed_at && ms(k.removed_at) < ms(k.added_at)) p(k.id + ': removed before it was added');
      if (k.removed_reason === 'member_left' && (!m || m.status !== 'left' || k.removed_at !== m.ended_at)) p(k.id + ': removed as member_left but not when its member left');
    }
  }
  const linkActive = (l, at) => ms(l.created_at) <= at && !(l.revoked_at && ms(l.revoked_at) <= at) && !(l.expires_at && ms(l.expires_at) <= at);
  for (const l of data.links) {
    if (ms(l.created_at) < ms(albums.get(l.album_id).created_at)) p(l.id + ': created before its album');
    if (l.revoked_at && ms(l.revoked_at) <= ms(l.created_at)) p(l.id + ': revoked before it was created');
  }
  // Views: through a link that was active then, or by a member who was joined then, of what the album showed then.
  for (const v of data.views) {
    const at = ms(v.at), a = albums.get(v.surface.album_id);
    if (v.surface.type === 'link' && !linkActive(data.links.find(l => l.id === v.surface.link_id), at)) p(v.id + ': the link was not active then');
    if (v.surface.type === 'album') {
      const m = a.members.find(x => x.person_id === v.viewer.person_id);
      if (!m || !m.joined_at || ms(m.joined_at) > at || (m.ended_at && ms(m.ended_at) <= at)) p(v.id + ': the viewer was not a joined member then');
    }
    for (const id of v.viewed_item_ids) {
      const it = items.get(id), c = contributions.get(id);
      if (c) { if (c.a !== a || ms(c.k.added_at) > at || (c.k.removed_at && ms(c.k.removed_at) <= at)) p(v.id + ': ' + id + ' was not in the album then'); continue; }
      const cleared = it.removal_history.some(r => r.album_ids.includes(a.id) && ms(r.at) > at);
      if (ms(it.added_at) > at || inTrash(id, at) || !(a.item_ids.includes(id) || cleared || it.state !== 'active')) p(v.id + ': ' + id + ' was not shown by the album then');
    }
  }
  // Removal requests: answered after they were made, honoured only on what was shared then.
  const sharedAt = (a, at) => a.members.some(m => openAt(m, at)) || data.links.some(l => l.album_id === a.id && linkActive(l, at));
  for (const r of data.removals) {
    const at = ms(r.requested_at);
    for (const id of r.item_ids) { const x = items.get(id) || contributions.get(id).k; if (ms(x.added_at) > at) p(r.id + ': requested before ' + id + ' existed'); }
    if (r.scope.album_id && ms(albums.get(r.scope.album_id).created_at) > at) p(r.id + ': its album did not exist yet');
    r.answers.forEach((x, k) => { if (ms(x.at) < at || (k && ms(x.at) < ms(r.answers[k - 1].at))) p(r.id + ': answer out of order'); });
    if (r.honored_at && r.honored_at !== r.answers[r.answers.length - 1].at) p(r.id + ': honored_at is not its last answer');
    if (r.withdrawn_at && ms(r.withdrawn_at) < at) p(r.id + ': withdrawn before it was made');
    for (const c of r.cleared || []) {
      const h = ms(r.honored_at);
      for (const id of c.album_ids) if (!sharedAt(albums.get(id), h)) p(r.id + ': cleared ' + id + ', which was not shared then');
      for (const id of c.link_ids) { const l = data.links.find(x => x.id === id); if (!l || !c.album_ids.includes(l.album_id) || !linkActive(l, h)) p(r.id + ': cleared link ' + id + ' was not active on a cleared album'); }
    }
  }
  // Storage over time: never over the quota; bytes leave only when an item is purged.
  const gone = i => (i.state === 'purged' ? ms(i.purged_at) : i.state === 'trashed' && ms(i.purge_at) <= t ? ms(i.purge_at) : Infinity);
  const usedAt = at => data.items.reduce((n, i) => n + (i.backed_up && ms(i.added_at) <= at && gone(i) > at ? i.declared_bytes : 0), 0);
  for (const i of data.items) if (i.backed_up && usedAt(ms(i.added_at)) > quota) p(i.id + ': backed up over the quota');
  for (const n of data.notifications.filter(x => x.kind === 'storage.threshold' && x.level === 80)) if (usedAt(ms(n.at)) < 0.8 * quota) p(n.id + ': 80% notice while under 80%');
  if (!data.activity.length) return;

  // The activity log covers everything the records say happened, each at its time.
  const rows = data.activity, known = new Set([data.account_id, ...items.keys(), ...contributions.keys(), ...albums.keys(), ...data.links.map(l => l.id),
    ...data.views.map(v => v.id), ...data.removals.map(r => r.id), ...data.notifications.map(n => n.id), ...data.stacks.map(s => s.id),
    ...data.people.map(x => x.person_id)]);
  rows.forEach((r, k) => {
    if (k && ms(r.at) < ms(rows[k - 1].at)) p('activity ' + r.seq + ' is out of time order');
    if (ms(r.at) > t) p('activity ' + r.seq + ' is after the clock');
    for (const id of r.object_ids) if (!known.has(id)) p('activity ' + r.seq + ' names unknown ' + id);
  });
  const find = (action, at, ids) => rows.find(r => r.action === action && (at === null || r.at === at) && ids.every(id => r.object_ids.includes(id)));
  const want = (action, at, ids, what) => { if (!find(action, at, ids)) p('activity has no ' + action + ' row for ' + what); };
  for (const i of data.items) {
    const arrivals = rows.filter(r => ['library.imported', 'device.synced'].includes(r.action) && r.object_ids.includes(i.id));
    if (arrivals.length !== 1 || ms(arrivals[0].at) < ms(i.added_at)) p('activity: ' + i.id + ' does not arrive exactly once, after added_at');
    else if (arrivals[0].action === 'device.synced' && localDate(arrivals[0].at, zone) !== localDate(i.added_at, zone)) p('activity: ' + i.id + ' synced on another day');
    for (const h of i.history) {
      const action = {trashed: 'items.trash', restored: 'items.restore', purged: 'items.purge', updated: 'items.update', removal_honored: 'removals.respond'}[h.action];
      if (action) want(action, h.at, [i.id], i.id + ' ' + h.action + ' at ' + h.at);
    }
  }
  const entered = (a, id) => rows.filter(r => r.action === 'albums.update' && r.object_ids[0] === a.id && r.object_ids.includes(id)).map(r => ms(r.at));
  for (const a of data.albums) {
    want('albums.create', a.created_at, [a.id], a.id);
    const cleared = data.removals.flatMap(r => (r.cleared || []).filter(c => c.album_ids.includes(a.id)).map(c => c.item_id));
    for (const id of [...a.item_ids.filter(x => items.has(x)), ...cleared]) {
      const times = entered(a, id), it = items.get(id);
      if (!times.length) { p('activity: ' + id + ' never entered ' + a.id); continue; }
      const at = Math.min(...times);
      if (at < ms(it.added_at) || at < ms(a.created_at) || inTrash(id, at)) p('activity: ' + id + ' entered ' + a.id + ' before it could');
      for (const v of data.views) if (v.surface.album_id === a.id && v.viewed_item_ids.includes(id) && ms(v.at) < at) p(v.id + ': shows ' + id + ' before it entered ' + a.id);
    }
    for (const m of a.members) {
      want('albums.members.invite', m.invited_at, [a.id, m.person_id], a.id + ' invite ' + m.person_id);
      if (m.joined_at) want('event.member.changed', m.joined_at, [a.id, m.person_id], m.person_id + ' joining ' + a.id);
      if (m.ended_at) want('event.member.changed', m.ended_at, [a.id, m.person_id], m.person_id + ' ' + m.status + ' ' + a.id);
    }
    for (const k of a.contributions) want('event.contribution.changed', k.added_at, [a.id, k.id], k.id);
  }
  for (const l of data.links) { want('links.create', l.created_at, [l.id], l.id); if (l.revoked_at) want('links.revoke', l.revoked_at, [l.id], l.id + ' revoked'); }
  for (const v of data.views) want('event.share.viewed', v.at, [v.id], v.id);
  for (const r of data.removals) {
    want('event.removal.requested', r.requested_at, [r.id], r.id);
    for (const x of r.answers) want('removals.respond', x.at, [r.id], r.id + ' ' + x.decision);
    if (r.withdrawn_at) want('event.removal.withdrawn', r.withdrawn_at, [r.id], r.id + ' withdrawn');
  }
  // Notifications: exactly one for each event that writes one, at its time, with its effect row.
  const expected = [];
  for (const a of data.albums) {
    for (const m of a.members) {
      if (m.joined_at) expected.push(['album.activity', m.joined_at, a.id]);
      if (m.ended_at) expected.push(['album.activity', m.ended_at, a.id]);
    }
    for (const at of new Set(a.contributions.map(k => k.person_id + '|' + k.added_at))) expected.push(['album.activity', at.split('|')[1], a.id]);
  }
  for (const r of data.removals) {
    expected.push(['removal.requested', r.requested_at, r.id]);
    if (r.withdrawn_at) expected.push(['removal.withdrawn', r.withdrawn_at, r.id]);
  }
  for (const r of rows.filter(x => x.action === 'device.synced')) {
    const after = usedAt(ms(r.at)), bytes = r.object_ids.reduce((n, id) => n + (items.get(id).backed_up ? items.get(id).declared_bytes : 0), 0);
    if (after - bytes < 0.8 * quota && after >= 0.8 * quota) expected.push(['storage.threshold', r.at, data.account_id]);
  }
  const key = x => x.join('|'), have = data.notifications.map(n => key([n.kind, n.at, n.object_id])).sort(), wanted = expected.map(key).sort();
  if (JSON.stringify(have) !== JSON.stringify(wanted)) p('notifications do not match the events that write them: missing ' + JSON.stringify(wanted.filter(x => !have.includes(x))) + ', extra ' + JSON.stringify(have.filter(x => !wanted.includes(x))));
  for (const n of data.notifications) {
    const r = rows.find(x => x.action === 'effect.notification.written' && x.object_ids[0] === n.id);
    const cause = r && rows.find(x => x.seq === r.cause_seq);
    if (!r || r.at !== n.at || !cause || cause.actor !== 'event' || cause.at !== n.at) p(n.id + ': no effect row caused by an event at its time');
  }
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
    // The library holds 420 items; 8 more are records of photos purged in 2025 and 2026.
    items: [count(i => i.state !== 'purged'), 420], purged_records: [count(i => i.state === 'purged'), 8],
    photos: [count(i => i.kind === 'photo' && i.state !== 'purged'), 380], videos: [count(i => i.kind === 'video'), 40], files: [count(i => i.file), 48],
    labels: [data.labels.length, 12], places: [new Set(data.items.filter(i => i.place).map(i => i.place.label)).size, 30],
    edit_stacks: [kinds('edit'), 10], burst_stacks: [kinds('burst'), 8], duplicate_stacks: [kinds('duplicate'), 8],
    exact_duplicate_pairs: [Object.values(hashes).filter(n => n === 2).length, 6], albums: [data.albums.length, 12],
    shared_albums: [data.albums.filter(a => d.albumState(a) === 'shared').length, 4], members: [data.albums.reduce((n, a) => n + a.members.length, 0), 11],
    contributions: [data.albums.reduce((n, a) => n + a.contributions.length, 0), 14], links: [data.links.length, 6], views: [data.views.length, 16],
    saves: [data.views.reduce((n, v) => n + v.saved_item_ids.length, 0), 7], removal_requests: [data.removals.length, 8], removal_states: [states.size, 4],
    in_trash: [count(i => i.state === 'trashed'), 20], past_retention: [count(i => i.state === 'trashed' && d.itemState(i, t) === 'purged'), 4],
    notifications: [data.notifications.length, 27], opened_at: [data.account.opened_at, '2025-01-04T10:00:00-08:00'], quota: [data.account.quota_bytes, 15e9], used_bytes: [s.used_bytes, 13.95e9], trash_bytes: [s.trash_bytes, 0.41e9],
    pending_bytes: [s.pending_bytes, 0]
  };
  for (const [k, [actual, wanted]] of Object.entries(expect)) if (actual !== wanted) p(k + ' is ' + actual + ', expected ' + wanted);
  if (data.items.some(i => i.taken_at < '2024-01-01')) p('capture times should span 2024 to 2026');
  // History across both years: items arrive in every month from January 2025, and 2025 holds
  // sharing, views, requests, trash and purges, notifications and activity of its own.
  const months = new Set(data.items.map(i => localDate(i.added_at, data.account.time_zone).slice(0, 7)));
  for (let m = 1; m <= 12; m++) if (!months.has('2025-' + String(m).padStart(2, '0'))) p('no item was added in 2025-' + String(m).padStart(2, '0'));
  const in2025 = list => list.filter(x => x.startsWith('2025')).length;
  const y = {links: in2025(data.links.map(l => l.created_at)), views: in2025(data.views.map(v => v.at)), requests: in2025(data.removals.map(r => r.requested_at)),
    trashed: in2025(data.items.filter(i => i.trashed_at).map(i => i.trashed_at)), notifications: in2025(data.notifications.map(n => n.at)), activity: in2025(data.activity.map(r => r.at))};
  for (const [k, n] of Object.entries(y)) if (!n) p('nothing of kind ' + k + ' in 2025');
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
// The record and history rules alone, for one fixture's data (used by the tests on altered copies).
function problemsOf(name, data) { const problems = []; check(name, data, problems); return problems; }
module.exports = {run, problemsOf};
if (require.main === module) {
  const {problems, image_bytes} = run();
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log('minimal.json and reference.json: no problems; ' + catalog.assets.length + ' image files, ' + image_bytes + ' bytes.');
}
