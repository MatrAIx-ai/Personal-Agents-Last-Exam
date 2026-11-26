#!/usr/bin/env node
'use strict';
// Authoring-time check, never run by the App or the host: seeded random walks over every
// write, every event and the clock, starting from the package fixture.
//   node dev/walk.cjs [first seed] [last seed] [steps] [--report FILE]     (default: seeds 1 to 20, 300 steps each)
// The harness checks every argument, result and resulting state against the schemas and the
// seed rules at each step. This script adds an oracle of its own for the notification rules:
// before each event it works out, from the stored records alone and without the App's
// business code, whether a notification must be written, with which delivery, reasons,
// release time and superseding, and compares that with what the App wrote. Every few steps
// it also compares the reads with each other, with the stored records and with the
// sender's plan. A refused call or event must leave the data as it was, and may only be
// refused with a code the operation documents. Deterministic: the only randomness is a
// seeded generator. It reads only files of this package.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { fixture } = require('../tests/harness.cjs');
const sender = require('../infra/sender.cjs');
const { TOPIC, PRIORITY, EVENTS } = require('./contracts.cjs');

// ---- an oracle that shares no code with src/ ------------------------------------------------
const instant = value => Date.parse(value), MINUTE = 60000;
const formats = new Map();
function wall(t, tz) {
  let f = formats.get(tz);
  if (!f) formats.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }));
  const p = {};
  for (const part of f.formatToParts(new Date(t))) p[part.type] = part.value;
  return (+p.hour % 24) * 60 + +p.minute;
}
const minutes = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
// The first whole minute at or after `t` at which the wall clock of `tz` shows `hhmm`.
function nextWall(t, tz, hhmm) {
  const base = Math.ceil(t / MINUTE) * MINUTE, guess = base + ((minutes(hhmm) - wall(base, tz) + 1440) % 1440) * MINUTE;
  if (wall(guess, tz) === minutes(hhmm)) return guess;
  for (let m = base; m <= base + 50 * 60 * MINUTE; m += MINUTE) if (wall(m, tz) === minutes(hhmm)) return m;
  throw new Error('no such wall time');
}
const RANK = { routine: 0, important: 1, urgent: 2 };
const TYPE = { 'item.published': 'original', 'item.updated': 'update', 'item.corrected': 'correction', 'item.retracted': 'retraction' };
function chain(data, id) { const out = []; for (let a = data.areas.find(x => x.id === id); a; a = data.areas.find(x => x.id === a.parent_id)) out.push(a.id); return out; }
const overlap = (data, a, b) => chain(data, a).includes(b) || chain(data, b).includes(a);
// What the App must do with an arriving revision, worked out from the state before the event.
function expected(data, event) {
  const p = event.payload, type = TYPE[event.operation.slice(10)], T = instant(event.at);
  const item = data.items.find(i => i.id === p.item_id) || { id: p.item_id, source_id: p.source_id, revisions: [] };
  const content = type === 'retraction' ? item.revisions[item.revisions.length - 1] : p.revision;
  const rules = data.follows.filter(r => !r.paused && (!r.source_ids.length || r.source_ids.includes(item.source_id)) && (!r.topics.length || content.topics.some(t => r.topics.includes(t)))
    && RANK[content.priority] >= RANK[r.min_priority] && (!r.area_ids.length || content.area_ids.some(a => r.area_ids.some(b => overlap(data, a, b)))));
  const earlier = data.notifications.filter(n => n.item_id === item.id), previous = earlier[earlier.length - 1], watched = data.clippings.some(c => c.item_id === item.id && c.watch);
  if (!rules.length && !previous && !watched) return null;
  const pr = data.preferences, q = pr.quiet_hours, now = wall(T, pr.timezone), s = minutes(q.start), e = minutes(q.end);
  const quiet = q.enabled && (s < e ? now >= s && now < e : now >= s || now < e);
  const immediate = rules.some(r => r.delivery === 'immediate') || watched || Boolean(previous && previous.delivery === 'immediate') || ((type === 'correction' || type === 'retraction') && pr.corrections === 'immediate');
  return {
    kind: event.operation.slice(10), revision: p.revision.number, delivery: immediate ? 'immediate' : 'digest',
    release: immediate ? (quiet && content.priority !== 'urgent' ? nextWall(T + 1, pr.timezone, q.end) : T) : nextWall(T, pr.timezone, pr.digest_time),
    reasons: [...(rules.length ? ['follow'] : []), ...(previous ? ['earlier_notification'] : []), ...(watched ? ['watched_clipping'] : [])], matched: rules.map(r => r.id),
    supersedes: previous && instant(previous.release_at) > T ? previous.id : null, email: pr.email_notices,
  };
}
const statusOf = item => (item.revisions[item.revisions.length - 1].type === 'retraction' ? 'retracted' : item.revisions.some(r => r.type === 'correction') ? 'corrected' : 'current');

// ---- the walk ----------------------------------------------------------------------------------
function generator(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ZONES = ['America/Chicago', 'America/New_York', 'Europe/Berlin', 'Asia/Kolkata'];
// The codes an operation may answer besides committing.
const MAY_REFUSE = {
  'follows.create': ['already_following', 'limit_exceeded', 'invalid_arguments', 'not_found'], 'follows.update': ['already_following', 'invalid_arguments', 'not_found'], 'follows.remove': ['not_found'],
  'preferences.update': ['invalid_arguments', 'invalid_timezone'], 'reading.mark': ['already_read', 'not_found'], 'clippings.add': ['already_clipped', 'limit_exceeded', 'not_found'],
  'clippings.update': ['invalid_revision', 'not_found', 'invalid_arguments'], 'clippings.remove': ['not_found'],
};

function walk(seedNumber, steps = 300, compareEvery = 4) {
  const rng = generator(seedNumber), pick = list => list[Math.floor(rng() * list.length)], chance = p => rng() < p, int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const some = (list, lo, hi) => { const out = []; for (let n = int(lo, hi); out.length < Math.min(n, list.length);) { const x = pick(list); if (!out.includes(x)) out.push(x); } return out; };
  const seed = structuredClone(require('../fixtures/minimal.json'));
  // Each seed number walks under its own preferences, where the tests use the fixture's own.
  seed.preferences = { timezone: ZONES[seedNumber % 4], quiet_hours: { enabled: seedNumber % 2 === 1, start: '22:00', end: '07:00' }, digest_time: seedNumber % 3 === 0 ? '07:30' : '18:00', corrections: seedNumber % 3 === 1 ? 'immediate' : 'as_item', email_notices: seedNumber % 5 !== 0 };
  const app = fixture({ seed }), seen = {}, sent = {};
  const count = (name, ok) => { seen[name] = seen[name] || { ok: 0, refused: 0 }; seen[name][ok ? 'ok' : 'refused']++; };
  let serial = 0, events = 0;
  const hhmm = () => String(int(0, 23)).padStart(2, '0') + ':' + pick(['00', '15', '30', '45']);
  const stamp = t => new Date(t).toISOString().replace('.000Z', '+00:00');
  const areaIds = seed.areas.map(a => a.id), sourceIds = seed.sources.map(s => s.id);
  const text = () => ({ headline: 'Walk headline ' + (++serial), body: 'Walk body ' + serial + ' about ' + pick(['water', 'the bridge', 'the library', 'Thursday', 'a meeting']) + '.', topics: some(TOPIC, 1, 2), area_ids: some(areaIds, 1, 2), priority: pick(['routine', 'routine', 'routine', 'important', 'important', 'urgent']) });

  function anEvent(data, T) {
    const at = stamp(T), live = data.items.filter(i => i.revisions[i.revisions.length - 1].type !== 'retraction'), wrong = chance(0.12);
    const roll = rng(), name = roll < 0.4 || !live.length ? 'item.published' : roll < 0.65 ? 'item.updated' : roll < 0.88 ? 'item.corrected' : 'item.retracted';
    const event = { event_id: 'walk-' + seedNumber + '-' + (++events), at, operation: 'belltower.' + name, payload: {} };
    if (name === 'item.published') {
      const kind = chance(0.3) ? 'notice' : 'article', basis = chance(0.25) ? pick(data.items) : null;
      event.payload = { item_id: 'it-walk-' + seedNumber + '-' + events, source_id: pick(sourceIds), kind, revision: { number: 1, published_at: stamp(T - int(0, 30) * MINUTE), ...text(),
        ...(kind === 'notice' && chance(0.8) ? { effective: { start: stamp(T + int(-600, 2000) * MINUTE), end: chance(0.3) ? null : stamp(T + int(2001, 9000) * MINUTE) } } : {}),
        ...(basis ? { based_on: { item_id: basis.id, revision: int(1, basis.revisions.length), relation: pick(['copy', 'report']) } } : {}) } };
      if (wrong) pick([() => { event.payload.revision.number = 2; }, () => { event.payload.item_id = pick(data.items).id; }, () => { event.payload.revision.published_at = stamp(T + MINUTE); }, () => { event.payload.source_id = 'src-nowhere'; },
        () => { event.payload.revision.based_on = { item_id: pick(data.items).id, revision: 60, relation: 'copy' }; }])();
      return { event, wrong };
    }
    const item = wrong && chance(0.4) && live.length < data.items.length ? pick(data.items.filter(i => !live.includes(i))) : pick(live), last = item.revisions[item.revisions.length - 1];
    const published = stamp(Math.max(instant(last.published_at), T - int(0, 30) * MINUTE)), number = last.number + (wrong && live.includes(item) ? pick([0, 2]) : 1);
    event.payload = { item_id: item.id, revision: name === 'item.retracted' ? { number, published_at: published, note: 'Walk retraction ' + events + '.' }
      : { number, published_at: published, ...(name === 'item.corrected' ? { note: 'Walk correction ' + events + '.' } : {}), ...text(), ...(item.kind === 'notice' && chance(0.7) ? { effective: { start: stamp(T - 60 * MINUTE), end: stamp(T + int(1, 5000) * MINUTE) } } : {}) } };
    return { event, wrong: wrong || !live.includes(item) };
  }
  function aWrite(data) {
    const name = pick(Object.keys(MAY_REFUSE)), item = pick(data.items), rule = data.follows.length ? pick(data.follows) : null, clip = data.clippings.length ? pick(data.clippings) : null;
    const filters = () => ({ ...(chance(0.5) ? { source_ids: some(sourceIds, 0, 2) } : {}), ...(chance(0.6) ? { area_ids: some(areaIds, 0, 2) } : {}), ...(chance(0.6) ? { topics: some(TOPIC, 0, 2) } : {}), ...(chance(0.5) ? { min_priority: pick(PRIORITY) } : {}) });
    const args = {
      'follows.create': () => ({ ...filters(), delivery: pick(['immediate', 'digest']) }),
      'follows.update': () => ({ id: rule ? rule.id : 'fl-9999', patch: pick([{ paused: chance(0.5) }, { delivery: pick(['immediate', 'digest']) }, filters(), { paused: false, ...filters() }]) }),
      'follows.remove': () => ({ id: rule && chance(0.6) ? rule.id : 'fl-9999' }),
      'preferences.update': () => ({ patch: pick([{ digest_time: hhmm() }, { quiet_hours: { enabled: chance(0.5) } }, { quiet_hours: { start: hhmm(), end: hhmm() } }, { corrections: pick(['as_item', 'immediate']) }, { email_notices: chance(0.7) }, { timezone: pick([...ZONES, 'Nowhere/Land']) }, {}]) }),
      'reading.mark': () => ({ id: item.id, ...(chance(0.5) ? { revision: int(1, item.revisions.length + (chance(0.1) ? 1 : 0)) } : {}) }),
      'clippings.add': () => ({ id: item.id, ...(chance(0.5) ? { note: 'Walk note ' + (++serial) } : {}), ...(chance(0.5) ? { watch: chance(0.6) } : {}), ...(chance(0.2) ? { linked_object: { app_id: 'calendar', object_type: 'event', object_id: 'evt-' + serial } } : {}) }),
      'clippings.update': () => ({ id: clip ? clip.id : 'clp-9999', patch: pick([{ watch: chance(0.5) }, { note: chance(0.3) ? null : 'Walk note ' + (++serial) }, { revision: clip ? int(1, data.items.find(i => i.id === clip.item_id).revisions.length + 1) : 1 }, { linked_object: null }, {}]) }),
      'clippings.remove': () => ({ id: clip && chance(0.5) ? clip.id : 'clp-9999' }),
    }[name]();
    return { name, args };
  }
  function compare(data, now) {
    // The log, the list read and the sender's plan agree on every notification.
    const listed = [];
    for (let cursor; ;) { const page = app.call('notifications.list', cursor ? { limit: 100, cursor } : { limit: 100 }); listed.push(...page.notifications); cursor = page.next_cursor; if (!cursor) break; }
    assert.equal(listed.length, data.notifications.length);
    const stateOf = n => (n.superseded_by !== undefined ? 'superseded' : instant(n.release_at) > now ? 'held' : 'released'), latest = new Map(data.items.map(i => [i.id, i.revisions.length]));
    for (const n of listed) assert.equal(n.state, stateOf(data.notifications.find(x => x.id === n.id)), n.id);
    const plan = sender.plan(app.snapshot(), sent), planned = new Map([...plan.dispatch.map(n => [n.id, 'dispatch']), ...plan.skipped.map(s => [s.notification_id, s.reason])]);
    const history = new Set(seed.notifications.filter(n => n.superseded_by !== undefined || instant(n.release_at) <= instant(require('../fixtures/clock.json').initial_time)).map(n => n.id));
    for (const n of data.notifications) {
      const want = history.has(n.id) || n.wire === undefined || sent[n.id] ? undefined : stateOf(n) !== 'released' ? stateOf(n) : latest.get(n.item_id) === n.revision ? 'dispatch' : 'replaced';
      assert.equal(planned.get(n.id), want, 'sender plan for ' + n.id);
    }
    for (const n of plan.dispatch) sent[n.id] = true;
    assert.deepEqual(plan.dispatch.map(n => instant(n.release_at)), plan.dispatch.map(n => instant(n.release_at)).sort((a, b) => a - b), 'dispatch is in order of release time');
    // Items: three of them read back as stored, with the states the records give.
    for (const item of [pick(data.items), pick(data.items), data.items[data.items.length - 1]]) {
      const got = app.call('items.get', { id: item.id }).item, last = item.revisions[item.revisions.length - 1], marks = data.read_marks.filter(m => m.item_id === item.id).map(m => m.revision), read = marks.length ? Math.max(...marks) : null;
      const e = last.effective, clip = data.clippings.find(c => c.item_id === item.id);
      assert.deepEqual([got.latest_revision, got.revision, got.type, got.is_latest, got.status, got.body, got.effect, got.last_read_revision, got.changed_since_read, got.clipping_id, got.revisions.length],
        [last.number, last.number, last.type, true, statusOf(item), last.body ?? null, e ? (now < instant(e.start) ? 'upcoming' : e.end === null || now < instant(e.end) ? 'in_effect' : 'ended') : null, read, read !== null && read < last.number, clip ? clip.id : null, item.revisions.length], item.id);
      assert.deepEqual(got.referenced_by.length, data.items.flatMap(i => i.revisions).filter(r => r.based_on && r.based_on.item_id === item.id).length);
    }
    // A list filter against the stored revisions: every item with a revision of that topic, and only those.
    const topic = pick(TOPIC), found = [];
    for (let cursor; ;) { const page = app.call('items.list', cursor ? { topic, limit: 100, cursor } : { topic, limit: 100 }); found.push(...page.items); cursor = page.next_cursor; if (!cursor) break; }
    const want = data.items.filter(i => i.revisions.some((r, k) => (r.type === 'retraction' ? i.revisions[k - 1] : r).topics.includes(topic))).map(i => i.id).sort();
    assert.deepEqual(found.map(i => i.id).sort(), want, 'items.list topic ' + topic);
    // Clippings and read marks.
    for (const c of app.call('clippings.list', {}).clippings) assert.equal(c.is_current, c.revision === latest.get(c.item_id), c.id);
    assert.equal(app.call('follows.list', {}).follows.filter(f => f.state === 'paused').length, data.follows.filter(f => f.paused).length);
  }

  for (let step = 1; step <= steps; step++) {
    const before = app.data, T = instant(app.now) + int(0, 120) * MINUTE, roll = rng(), rows = before.activity.length;
    if (roll < 0.45) {
      const { event, wrong } = anEvent(before, T), want = wrong ? undefined : expected(before, event), name = event.operation.slice(10);
      let failure = null;
      try { app.event(event); } catch (e) { failure = e; }
      if (failure) {
        assert.ok(wrong && failure.code === 'invalid_event', 'seed ' + seedNumber + ' step ' + step + ': ' + name + ' was refused: ' + failure.code + ' ' + failure.message);
        assert.deepEqual(app.data, before, 'a refused event leaves the data as it was');
        count(name, false);
        continue;
      }
      assert.ok(!wrong, 'seed ' + seedNumber + ' step ' + step + ': a malformed ' + name + ' was accepted');
      const after = app.data, written = after.notifications.slice(before.notifications.length), where = 'seed ' + seedNumber + ' step ' + step + ' ' + name + ' ' + event.payload.item_id;
      if (want === null) assert.equal(written.length, 0, where + ': no notification is due');
      else {
        assert.equal(written.length, 1, where + ': exactly one notification is due');
        const n = written[0];
        assert.deepEqual([n.kind, n.revision, n.delivery, instant(n.release_at), n.reasons, n.matched_follow_ids, n.supersedes ?? null, n.wire !== undefined, instant(n.created_at)],
          [want.kind, want.revision, want.delivery, want.release, want.reasons, want.matched, want.supersedes, want.email, T], where);
        if (want.supersedes) assert.equal(after.notifications.find(x => x.id === want.supersedes).superseded_by, n.id, where);
      }
      // One activity row for the event and one for each effect; every other record is as it was.
      assert.equal(after.activity.length - rows, 1 + (want ? 1 + (want.supersedes ? 1 : 0) : 0), where);
      assert.deepEqual([after.follows, after.read_marks, after.clippings, after.preferences, after.items.length - before.items.length], [before.follows, before.read_marks, before.clippings, before.preferences, name === 'item.published' ? 1 : 0], where);
      count(name, true);
    } else if (roll < 0.9) {
      app.advance(stamp(T));
      const { name, args } = aWrite(before);
      let failure = null;
      try { app.call(name, args); } catch (e) { failure = e; }
      if (failure) {
        assert.ok(MAY_REFUSE[name].includes(failure.code), 'seed ' + seedNumber + ' step ' + step + ': ' + name + ' answered ' + failure.code + ': ' + failure.message);
        assert.deepEqual(app.data, before, 'a refused call leaves the data as it was');
      } else {
        const after = app.data;
        assert.equal(after.activity.length - rows, 1, name + ' writes one activity row');
        assert.deepEqual([after.items, after.notifications], [before.items, before.notifications], 'the account\'s own writes touch no item and write or withdraw no notification');
      }
      count(name, !failure);
    } else {
      app.advance(stamp(T + int(0, 1440) * MINUTE));
      assert.deepEqual(app.data, before, 'the clock alone changes no record');
      count('env.advance_time', true);
    }
    if (step % compareEvery === 0) compare(app.data, instant(app.now));
  }
  return seen;
}

function main() {
  const args = process.argv.slice(2), reportAt = args.indexOf('--report'), reportFile = reportAt >= 0 ? args.splice(reportAt, 2)[1] : null;
  const [first = 1, last = 20, steps = 300] = args.map(Number), started = Date.now(), total = {};
  for (let seedNumber = first; seedNumber <= last; seedNumber++) for (const [name, c] of Object.entries(walk(seedNumber, steps))) { total[name] = total[name] || { ok: 0, refused: 0 }; total[name].ok += c.ok; total[name].refused += c.refused; }
  const operations = Object.values(total).reduce((sum, c) => sum + c.ok + c.refused, 0);
  const all = [...Object.keys(MAY_REFUSE), ...EVENTS.map(e => e.slice(10)), 'env.advance_time'];
  assert.ok(all.every(name => total[name] && total[name].ok > 0), 'every write, every event and the clock succeeded at least once');
  const report = { schema: 'belltower.random-walk.v1', node: process.version, seeds: [first, last], steps_per_seed: steps, operations, passed: true, duration_ms: Date.now() - started, by_operation: total };
  if (reportFile) fs.writeFileSync(path.resolve(reportFile), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS: ' + operations + ' operations in ' + (last - first + 1) + ' walks of ' + steps + ' steps (' + report.duration_ms + ' ms). ' + JSON.stringify(total));
}

module.exports = { walk };
if (require.main === module) main();
