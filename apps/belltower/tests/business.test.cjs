'use strict';
// App-only business tests T01-T18 of the proposal. They call the real business functions
// through tests/harness.cjs with the package fixture (clock: Tuesday 2026-11-17 17:00 -06:00)
// and need nothing outside this package. Core behavior (T17, the real env.advance_time of
// T16, reset in T18) needs the public runtime and lives in tests/mcp.integration.cjs; the
// Mail flow lives in tests/mail.integration.cjs. Both run from here only when
// PALE_RUNTIME_ROOT names the runtime directory of a public checkout.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { fixture, plugin } = require('./harness.cjs');
const sender = require('../infra/sender.cjs');

const at = (date, hhmm, offset = '-06:00') => date + 'T' + hhmm + (hhmm.length === 5 ? ':00' : '') + offset;
const TUE = '2026-11-17', WED = '2026-11-18', THU = '2026-11-19', FRI = '2026-11-20', SAT = '2026-11-21';
const CLOCK = at(TUE, '17:00');
const H = 'ar-halden', MB = 'ar-millbrook', FH = 'ar-ferry-hill', OQ = 'ar-old-quay', MN = 'ar-millbrook-north', MS = 'ar-millbrook-south', UF = 'ar-upper-ferry', QS = 'ar-quayside';
const WORKS = 'src-works', CITY = 'src-city', COURIER = 'src-courier', LEDGER = 'src-ledger', ROUNDUP = 'src-roundup', BULLETIN = 'src-bulletin';
// Items of the fixture that the tests lean on.
const BRIDGE = 'it-roads-0031', LIBRARY = 'it-city-0207', BOIL = 'it-water-0112', LANE = 'it-roads-0029', BUS = 'it-city-0203', CLINIC = 'it-cour-0907', MAIN = 'it-water-0115', COPY = 'it-round-5521';
const proposal = id => structuredClone(require('./proposal-events.json').find(e => e.event_id === id));
const scenario = () => structuredClone(require('../examples/scenario.json'));
const seedCopy = () => structuredClone(require('../fixtures/minimal.json'));
const seedWith = change => { const seed = seedCopy(); change(seed); return seed; };
// The fixture's world with an account that has done nothing yet: no rules, marks, clippings or notifications.
const bare = (change = () => {}) => seedWith(seed => { seed.follows = []; seed.read_marks = []; seed.clippings = []; seed.notifications = []; seed.activity = []; change(seed); });

// A failing call or event must leave business data exactly as it was.
function rejects(app, fn, code) {
  const before = app.data;
  assert.throws(fn, { code });
  assert.deepEqual(app.data, before);
}
let counter = 0;
const ev = (when, name, payload) => ({ event_id: 't-ev-' + (++counter), at: when, operation: 'belltower.' + name, payload });
const content = (item_id, number, over = {}) => ({ headline: 'Headline ' + number + ' of ' + item_id, body: 'Body ' + number + ' of ' + item_id + '.', topics: ['roads'], area_ids: [MB], priority: 'important', ...over });
// Events as a source would send them; `over` replaces fields of the revision.
const published = (when, item_id, over = {}) => {
  const { source_id = WORKS, kind = 'article', ...revision } = over;
  return ev(when, 'item.published', { item_id, source_id, kind, revision: { number: 1, published_at: when, ...content(item_id, 1, revision) } });
};
const updated = (when, item_id, number, over = {}) => ev(when, 'item.updated', { item_id, revision: { number, published_at: when, ...content(item_id, number, over) } });
const corrected = (when, item_id, number, over = {}) => ev(when, 'item.corrected', { item_id, revision: { number, published_at: when, note: 'Correction ' + number + ' of ' + item_id + '.', ...content(item_id, number, over) } });
const retracted = (when, item_id, number, over = {}) => ev(when, 'item.retracted', { item_id, revision: { number, published_at: when, note: 'Retraction of ' + item_id + '.', ...over } });
const item = (app, id, revision) => app.call('items.get', revision === undefined ? { id } : { id, revision }).item;
const listed = (app, args = {}) => app.call('items.list', { limit: 100, ...args }).items;
// Oldest first, so that a test reads in the order things happened.
const notifications = (app, args = {}) => app.call('notifications.list', { limit: 100, ...args }).notifications.reverse();
const newest = app => app.call('notifications.list', { limit: 1 }).notifications[0];
const clipping = (app, id) => app.call('clippings.list', {}).clippings.find(c => c.id === id);
const actions = (app, from = 0) => app.data.activity.slice(from).map(a => a.actor + ':' + a.action + ':' + a.object_id);
const brief = n => [n.kind, n.item_id, n.revision, n.state, n.delivery, n.release_at, n.reasons.join('+'), n.matched_follow_ids.join('+')];

test('T01 [W1] follow rules: create, update, pause and remove; an identical rule, unknown IDs, a rule with no filter, the limit of 20', () => {
  const app = fixture();
  const rules = app.call('follows.list', {}).follows;
  assert.deepEqual(rules.map(f => [f.id, f.state, f.delivery, f.min_priority]), [['fl-0001', 'active', 'digest', 'routine'], ['fl-0002', 'active', 'immediate', 'important'], ['fl-0003', 'active', 'immediate', 'important'], ['fl-0004', 'active', 'digest', 'routine'], ['fl-0005', 'paused', 'digest', 'routine']]);
  assert.deepEqual([rules[2].source_ids, rules[2].area_ids, rules[2].topics, rules[2].created_at, rules[2].updated_at], [[], [MB, FH], ['roads', 'transit'], at('2026-11-12', '08:10'), null]);
  assert.deepEqual([rules[4].created_at, rules[4].updated_at], [at('2026-11-14', '10:00'), at('2026-11-15', '21:00')], 'pausing is a change and carries its time');
  assert.deepEqual([app.call('follows.list', { state: 'paused' }).follows.map(f => f.id), app.call('follows.list', { state: 'active' }).follows.length], [['fl-0005'], 4]);

  // Create: the acceptance example, the area Millbrook North with delivery immediate.
  const start = app.data.activity.length;
  const made = app.call('follows.create', { area_ids: [MN], delivery: 'immediate' });
  assert.deepEqual(made, { id: 'fl-0006', follow: { id: 'fl-0006', state: 'active', source_ids: [], area_ids: [MN], topics: [], min_priority: 'routine', delivery: 'immediate', created_at: CLOCK, updated_at: null } });
  assert.deepEqual(app.call('follows.list', {}).follows.at(-1), made.follow, 'listed with its ID');

  // Update: only the fields in the patch change; a list replaces the old list.
  app.advance(at(TUE, '17:05'));
  const changed = app.call('follows.update', { id: 'fl-0006', patch: { delivery: 'digest', topics: ['roads', 'transit'], min_priority: 'important' } }).follow;
  assert.deepEqual([changed.delivery, changed.topics, changed.min_priority, changed.area_ids, changed.state, changed.created_at, changed.updated_at], ['digest', ['roads', 'transit'], 'important', [MN], 'active', CLOCK, at(TUE, '17:05')]);
  assert.deepEqual(app.call('follows.update', { id: 'fl-0006', patch: { topics: ['water'] } }).follow.topics, ['water']);
  // Pause and resume.
  assert.equal(app.call('follows.update', { id: 'fl-0006', patch: { paused: true } }).follow.state, 'paused');
  assert.deepEqual(app.call('follows.list', { state: 'paused' }).follows.map(f => f.id), ['fl-0005', 'fl-0006']);
  assert.equal(app.call('follows.update', { id: 'fl-0006', patch: { paused: false } }).follow.state, 'active');
  // Remove. The ID of a removed rule does not come back.
  assert.deepEqual(app.call('follows.remove', { id: 'fl-0006' }), { id: 'fl-0006', remaining: 5 });
  assert.deepEqual(app.call('follows.list', {}).follows.map(f => f.id), ['fl-0001', 'fl-0002', 'fl-0003', 'fl-0004', 'fl-0005']);
  assert.equal(app.call('follows.create', { area_ids: [MN], delivery: 'immediate' }).id, 'fl-0007');
  assert.deepEqual(actions(app, start), ['agent:follows.create:fl-0006', 'agent:follows.update:fl-0006', 'agent:follows.update:fl-0006', 'agent:follows.update:fl-0006', 'agent:follows.update:fl-0006', 'agent:follows.remove:fl-0006', 'agent:follows.create:fl-0007']);
  assert.deepEqual(app.data.activity[start + 1].details, { fields: ['delivery', 'topics', 'min_priority'] });

  // The same rule again: the same sources, areas, topics and minimum priority, in any order and whatever the delivery.
  rejects(app, () => app.call('follows.create', { area_ids: [MN], delivery: 'immediate' }), 'already_following');
  rejects(app, () => app.call('follows.create', { topics: ['transit', 'roads'], area_ids: [FH, MB], min_priority: 'important', delivery: 'digest' }), 'already_following');
  rejects(app, () => app.call('follows.create', { source_ids: [COURIER], topics: ['health'], delivery: 'immediate' }), 'already_following');
  rejects(app, () => app.call('follows.update', { id: 'fl-0001', patch: { source_ids: [CITY], area_ids: [], topics: ['schools', 'libraries'] } }), 'already_following');
  assert.equal(app.call('follows.create', { topics: ['transit', 'roads'], area_ids: [FH, MB], min_priority: 'urgent', delivery: 'digest' }).id, 'fl-0008', 'another minimum priority is another rule');
  // Unknown IDs.
  rejects(app, () => app.call('follows.create', { source_ids: ['src-nowhere'], delivery: 'digest' }), 'not_found');
  rejects(app, () => app.call('follows.create', { area_ids: [MB, 'ar-nowhere'], delivery: 'digest' }), 'not_found');
  rejects(app, () => app.call('follows.update', { id: 'fl-0001', patch: { area_ids: ['ar-nowhere'] } }), 'not_found');
  rejects(app, () => app.call('follows.update', { id: 'fl-0099', patch: { paused: true } }), 'not_found');
  rejects(app, () => app.call('follows.update', { id: 'fl-0006', patch: { paused: true } }), 'not_found');
  rejects(app, () => app.call('follows.remove', { id: 'fl-0006' }), 'not_found');
  rejects(app, () => app.call('follows.list', { state: 'removed' }), 'invalid_arguments');
  // A rule with no source, area or topic; an empty patch.
  rejects(app, () => app.call('follows.create', { delivery: 'digest' }), 'invalid_arguments');
  rejects(app, () => app.call('follows.create', { source_ids: [], area_ids: [], topics: [], min_priority: 'urgent', delivery: 'digest' }), 'invalid_arguments');
  rejects(app, () => app.call('follows.update', { id: 'fl-0007', patch: { area_ids: [] } }), 'invalid_arguments');
  rejects(app, () => app.call('follows.update', { id: 'fl-0007', patch: {} }), 'invalid_arguments');
  rejects(app, () => app.call('follows.create', { topics: ['sport'], delivery: 'digest' }), 'invalid_arguments');
  rejects(app, () => app.call('follows.create', { topics: ['roads'] }), 'invalid_arguments');

  // The limit of 20: seven rules exist, thirteen more fit, the next one does not.
  const topics = require('../dev/contracts.cjs').TOPIC;
  for (let i = 0; i < 13; i++) app.call('follows.create', { source_ids: [LEDGER], topics: [topics[i % 12]], min_priority: i < 12 ? 'routine' : 'urgent', delivery: 'digest' });
  assert.equal(app.call('follows.list', {}).follows.length, 20);
  rejects(app, () => app.call('follows.create', { source_ids: [BULLETIN], delivery: 'digest' }), 'limit_exceeded');
  rejects(app, () => app.call('follows.create', { area_ids: [MN], delivery: 'digest' }), 'already_following');
  app.call('follows.remove', { id: 'fl-0008' });
  assert.equal(app.call('follows.create', { source_ids: [BULLETIN], delivery: 'digest' }).id, 'fl-0022', 'room again after a removal');
});

test('T02 [W1] matching: source, topic, minimum priority and area overlap (the same area, a parent, a child; not a sibling); a paused rule matches nothing', () => {
  // One rule at a time on an account that has done nothing, so every notification is the rule's.
  const tell = (rule, revision, more = {}) => {
    const app = fixture({ seed: bare() });
    const id = app.call('follows.create', { delivery: 'immediate', ...rule }).id;
    if (more.paused) app.call('follows.update', { id, patch: { paused: true } });
    app.event(published(at(WED, '10:00'), 'it-test-1', revision));
    const all = notifications(app);
    assert.ok(all.length <= 1);
    if (all.length) assert.deepEqual([all[0].matched_follow_ids, all[0].reasons, all[0].kind], [[id], ['follow'], 'item.published']);
    return all.length === 1;
  };
  // Areas: the acceptance example is a rule for Millbrook North.
  assert.equal(tell({ area_ids: [MN] }, { area_ids: [MN] }), true, 'the same area');
  assert.equal(tell({ area_ids: [MN] }, { area_ids: [MB] }), true, 'an item tagged with the district that contains the rule\'s area');
  assert.equal(tell({ area_ids: [MN] }, { area_ids: [H] }), true, 'an item tagged with the whole city');
  assert.equal(tell({ area_ids: [MB] }, { area_ids: [MN] }), true, 'an item tagged with an area inside the rule\'s area');
  assert.equal(tell({ area_ids: [H] }, { area_ids: [QS] }), true, 'a rule for the city matches every area');
  assert.equal(tell({ area_ids: [MN] }, { area_ids: [MS] }), false, 'a sibling neighbourhood does not match');
  assert.equal(tell({ area_ids: [MN] }, { area_ids: [FH] }), false, 'an item tagged only Ferry Hill does not match');
  assert.equal(tell({ area_ids: [MB] }, { area_ids: [UF, QS] }), false);
  assert.equal(tell({ area_ids: [MN, OQ] }, { area_ids: [FH, QS] }), true, 'one overlapping pair is enough');
  // Source.
  assert.equal(tell({ source_ids: [CITY, COURIER] }, { source_id: CITY }), true);
  assert.equal(tell({ source_ids: [CITY, COURIER] }, { source_id: WORKS }), false);
  // Topic.
  assert.equal(tell({ topics: ['water', 'power'] }, { topics: ['roads', 'power'] }), true, 'one shared topic is enough');
  assert.equal(tell({ topics: ['water', 'power'] }, { topics: ['roads'] }), false);
  // Minimum priority.
  assert.equal(tell({ topics: ['roads'], min_priority: 'important' }, { priority: 'routine' }), false, 'below the minimum');
  assert.equal(tell({ topics: ['roads'], min_priority: 'important' }, { priority: 'important' }), true);
  assert.equal(tell({ topics: ['roads'], min_priority: 'important' }, { priority: 'urgent' }), true);
  assert.equal(tell({ topics: ['roads'], min_priority: 'urgent' }, { priority: 'important' }), false);
  assert.equal(tell({ topics: ['roads'] }, { priority: 'routine' }), true, 'routine is the default minimum');
  // Every filter the rule has must be met.
  const whole = { source_ids: [WORKS], area_ids: [MN], topics: ['roads'], min_priority: 'important' };
  assert.equal(tell(whole, { source_id: WORKS, area_ids: [MB], topics: ['roads'], priority: 'important' }), true);
  assert.equal(tell(whole, { source_id: CITY, area_ids: [MB], topics: ['roads'], priority: 'important' }), false);
  assert.equal(tell(whole, { source_id: WORKS, area_ids: [FH], topics: ['roads'], priority: 'important' }), false);
  assert.equal(tell(whole, { source_id: WORKS, area_ids: [MB], topics: ['water'], priority: 'important' }), false);
  assert.equal(tell(whole, { source_id: WORKS, area_ids: [MB], topics: ['roads'], priority: 'routine' }), false);
  // A paused rule matches nothing.
  assert.equal(tell({ area_ids: [MN] }, { area_ids: [MN] }, { paused: true }), false);

  // A retraction has no topics, areas or priority of its own: it is matched with those of the revision before it.
  const app = fixture({ seed: bare() });
  const rule = app.call('follows.create', { area_ids: [MN], topics: ['water'], min_priority: 'important', delivery: 'immediate' }).id;
  app.event(published(at(WED, '10:00'), 'it-test-2', { area_ids: [MN], topics: ['water'], priority: 'urgent' }));
  app.event(retracted(at(WED, '11:00'), 'it-test-2', 2));
  assert.deepEqual(notifications(app).map(n => [n.kind, n.matched_follow_ids]), [['item.published', [rule]], ['item.retracted', [rule]]]);
});

test('T03 [W1] preferences: quiet hours, digest time and time zone are validated; the corrections setting; later notifications follow a change and earlier ones keep their release time', () => {
  const app = fixture();
  assert.deepEqual(app.call('preferences.get', {}).preferences, {
    timezone: 'America/Chicago', quiet_hours: { enabled: true, start: '22:00', end: '07:00' }, digest_time: '18:00', corrections: 'as_item', email_notices: true,
    in_quiet_hours: false, next_digest_at: at(TUE, '18:00'),
  });
  const held = () => notifications(app, { state: 'held' }).map(n => [n.id, n.release_at]);
  assert.deepEqual(held(), [['ntf-0011', at(TUE, '18:00')]]);

  // The digest time: the acceptance example sets it; a later digest notification gets the new time and the earlier one keeps its own.
  const start = app.data.activity.length;
  const set = app.call('preferences.update', { patch: { digest_time: '19:30' } });
  assert.deepEqual([set.id, set.preferences.digest_time, set.preferences.next_digest_at], ['belltower-dana', '19:30', at(TUE, '19:30')]);
  assert.deepEqual(app.data.activity.slice(start).map(a => [a.actor, a.action, a.object_id, a.details]), [['agent', 'preferences.update', 'belltower-dana', { fields: ['digest_time'] }]]);
  app.event(published(at(TUE, '17:30'), 'it-test-1', { source_id: CITY, topics: ['schools'], area_ids: [OQ], priority: 'routine' }));
  assert.deepEqual(held(), [['ntf-0011', at(TUE, '18:00')], ['ntf-0013', at(TUE, '19:30')]]);

  // Validation: nothing changes on a refusal.
  rejects(app, () => app.call('preferences.update', { patch: {} }), 'invalid_arguments');
  rejects(app, () => app.call('preferences.update', { patch: { timezone: 'Mars/Olympus_Mons' } }), 'invalid_timezone');
  rejects(app, () => app.call('preferences.update', { patch: { timezone: ' ' } }), 'invalid_timezone');
  rejects(app, () => app.call('preferences.update', { patch: { quiet_hours: { start: '07:00' } } }), 'invalid_arguments');
  rejects(app, () => app.call('preferences.update', { patch: { quiet_hours: { start: '06:00', end: '06:00' } } }), 'invalid_arguments');
  // A digest time inside the quiet hours (22:00 to 07:00): the start is inside, the end is not.
  for (const inside of ['22:00', '23:00', '00:00', '06:59']) rejects(app, () => app.call('preferences.update', { patch: { digest_time: inside } }), 'invalid_arguments');
  for (const outside of ['07:00', '21:59', '12:00']) assert.equal(app.call('preferences.update', { patch: { digest_time: outside } }).preferences.digest_time, outside);
  // Quiet hours moved over the digest time are refused as well, in one patch or in two.
  rejects(app, () => app.call('preferences.update', { patch: { quiet_hours: { start: '11:00', end: '13:00' } } }), 'invalid_arguments');
  assert.deepEqual(app.call('preferences.update', { patch: { quiet_hours: { start: '13:00', end: '15:00' }, digest_time: '12:59' } }).preferences.quiet_hours, { enabled: true, start: '13:00', end: '15:00' });
  // With quiet hours off the digest time is free; turning them on again is checked.
  assert.equal(app.call('preferences.update', { patch: { quiet_hours: { enabled: false }, digest_time: '14:00' } }).preferences.digest_time, '14:00');
  rejects(app, () => app.call('preferences.update', { patch: { quiet_hours: { enabled: true } } }), 'invalid_arguments');
  assert.equal(app.call('preferences.update', { patch: { quiet_hours: { enabled: true, start: '22:00', end: '07:00' }, digest_time: '18:00' } }).preferences.in_quiet_hours, false);
  rejects(app, () => app.call('preferences.update', { patch: { digest_time: '6pm' } }), 'invalid_arguments');
  rejects(app, () => app.call('preferences.update', { patch: { corrections: 'never' } }), 'invalid_arguments');
  rejects(app, () => app.call('preferences.update', { patch: { language: 'en' } }), 'invalid_arguments');

  // The time zone: quiet hours and the digest are wall times of the account.
  const eastern = app.call('preferences.update', { patch: { timezone: 'America/New_York' } }).preferences;
  assert.deepEqual([eastern.timezone, eastern.next_digest_at, eastern.in_quiet_hours], ['America/New_York', '2026-11-18T18:00:00-05:00', false], '17:30 in Chicago is 18:30 in New York, past today\'s digest');
  app.call('preferences.update', { patch: { timezone: 'America/Chicago' } });
  app.advance(at(TUE, '23:00'));
  assert.deepEqual([app.call('preferences.get', {}).preferences.in_quiet_hours, app.call('preferences.get', {}).preferences.next_digest_at], [true, at(WED, '18:00')]);
  assert.deepEqual(held(), []);
  assert.deepEqual(notifications(app).slice(-3).map(n => [n.id, n.state, n.release_at]), [['ntf-0011', 'released', at(TUE, '18:00')], ['ntf-0012', 'released', at(TUE, '16:30')], ['ntf-0013', 'released', at(TUE, '19:30')]], 'every change above left the release times as they were written');

  // The corrections setting. as_item (the fixture's): the library correction of 11:20 went into the digest.
  const fresh = fixture();
  assert.deepEqual(brief(notifications(fresh).at(-2)).slice(0, 6), ['item.corrected', LIBRARY, 2, 'held', 'digest', at(TUE, '18:00')]);
  // immediate: the next correction of that item is delivered at once, and the held one is superseded.
  fresh.call('preferences.update', { patch: { corrections: 'immediate' } });
  fresh.event(corrected(at(TUE, '17:20'), LIBRARY, 3, { topics: ['libraries'], area_ids: [OQ], priority: 'routine' }));
  assert.deepEqual(brief(newest(fresh)), ['item.corrected', LIBRARY, 3, 'released', 'immediate', at(TUE, '17:20'), 'follow+earlier_notification', 'fl-0004']);
  assert.deepEqual(notifications(fresh, { id: LIBRARY }).map(n => [n.id, n.state, n.superseded_by]), [['ntf-0010', 'superseded', 'ntf-0011'], ['ntf-0011', 'superseded', 'ntf-0013'], ['ntf-0013', 'released', null]]);
  // An update is not a correction: under a digest rule it stays in the digest.
  fresh.event(published(at(TUE, '17:25'), 'it-test-2', { source_id: CITY, topics: ['schools'], area_ids: [OQ], priority: 'routine' }));
  fresh.event(updated(at(TUE, '17:26'), 'it-test-2', 2, { topics: ['schools'], area_ids: [OQ], priority: 'routine' }));
  assert.deepEqual(brief(newest(fresh)).slice(0, 6), ['item.updated', 'it-test-2', 2, 'held', 'digest', at(TUE, '18:00')]);

  // Email notices: turning them off stops new wire messages; the log is still written and earlier ones keep theirs.
  fresh.call('preferences.update', { patch: { email_notices: false } });
  fresh.event(retracted(at(TUE, '17:40'), 'it-test-2', 3));
  assert.deepEqual(notifications(fresh).slice(-3).map(n => [n.kind, n.email_prepared]), [['item.published', true], ['item.updated', true], ['item.retracted', false]]);
  assert.equal(fresh.data.notifications.at(-1).wire, undefined);
});

test('T04 [W2] items.get: the latest revision by default, an explicit revision, is_latest, the revision list with publishers\' notes; status current, corrected and retracted', () => {
  const app = fixture(), NOTE = 'An earlier version gave the wrong start day. The closure begins on Wednesday 18 November at 07:00, not Thursday 19 November.';
  // The acceptance example: the bridge notice at revision 1 (Monday) and its correction at revision 2 (Tuesday 16:30).
  const now = item(app, BRIDGE);
  assert.deepEqual([now.revision, now.type, now.is_latest, now.latest_revision, now.status, now.kind], [2, 'correction', true, 2, 'corrected', 'notice']);
  assert.deepEqual([now.source_id, now.source_name, now.source_kind], [WORKS, 'Halden Public Works', 'official']);
  assert.deepEqual([now.headline, now.note, now.topics, now.area_ids, now.priority], ['Kestrel Bridge closed for deck repairs from Wednesday', NOTE, ['roads'], [MB, FH], 'important']);
  assert.equal(now.body, 'Kestrel Bridge will be closed to all traffic from Wednesday 18 November at 07:00 until Saturday 21 November at 18:00. Use the Ferry Hill crossing.');
  assert.deepEqual(now.revisions, [
    { revision: 1, type: 'original', published_at: at('2026-11-16', '09:45'), received_at: at('2026-11-16', '10:00'), note: null, effective: { start: at(THU, '07:00'), end: at(SAT, '18:00') } },
    { revision: 2, type: 'correction', published_at: at(TUE, '16:30'), received_at: at(TUE, '16:30'), note: NOTE, effective: { start: at(WED, '07:00'), end: at(SAT, '18:00') } },
  ], 'every revision with its number, type, times and, for a correction, the publisher\'s note');
  // An explicit revision returns the original text and says that it is not the latest.
  const first = item(app, BRIDGE, 1);
  assert.deepEqual([first.revision, first.type, first.is_latest, first.latest_revision, first.status, first.note], [1, 'original', false, 2, 'corrected', null]);
  assert.deepEqual([first.headline, first.body], ['Kestrel Bridge closed for deck repairs from Thursday', 'Kestrel Bridge will be closed to all traffic from Thursday 19 November at 07:00 until Saturday 21 November at 18:00. Use the Ferry Hill crossing.']);
  assert.deepEqual([first.published_at, first.received_at, first.effective], [at('2026-11-16', '09:45'), at('2026-11-16', '10:00'), { start: at(THU, '07:00'), end: at(SAT, '18:00') }], 'published_at as the publisher states it, received_at when it reached Belltower');
  assert.deepEqual(first.revisions, now.revisions, 'the list is the same whichever revision is read');
  assert.deepEqual(item(app, BRIDGE, 2), now);
  // The account's own record of the item comes with it.
  assert.deepEqual([now.read_revisions, now.last_read_revision, now.changed_since_read, now.clipping_id], [[1], 1, true, null]);

  // Status. current: no correction and no retraction, also after an update.
  assert.deepEqual([item(app, CLINIC).status, item(app, 'it-city-0196').status, item(app, 'it-city-0196').type], ['current', 'current', 'update']);
  // corrected: any revision is a correction, also when a later update follows it.
  const boil = item(app, BOIL);
  assert.deepEqual([boil.status, boil.type, boil.revision, boil.note, boil.revisions.map(r => [r.type, r.note === null])], ['corrected', 'update', 3, null, [['original', true], ['correction', false], ['update', true]]]);
  assert.deepEqual([item(app, 'it-cour-0884').status, item(app, 'it-cour-0884').type], ['corrected', 'correction']);
  // retracted: the latest revision is a retraction. It has the publisher's note and no body, and
  // shows the headline, topics, areas and priority of the revision before it.
  const gone = item(app, 'it-cour-0893');
  assert.deepEqual([gone.status, gone.type, gone.revision, gone.is_latest, gone.body, gone.effective, gone.effect, gone.based_on], ['retracted', 'retraction', 2, true, null, null, null, null]);
  assert.deepEqual([gone.note, gone.headline, gone.topics, gone.area_ids, gone.priority], ['This report was published in error. No candidate has withdrawn; the Courier confused two filings.', 'Council candidate withdraws from Ferry Hill race', ['government'], [FH], 'routine']);
  assert.deepEqual(gone.revisions.map(r => [r.revision, r.type, r.note === null]), [[1, 'original', true], [2, 'retraction', false]]);
  const before = item(app, 'it-cour-0893', 1);
  assert.deepEqual([before.is_latest, before.status, before.type, before.body], [false, 'retracted', 'original', 'One of the three candidates for the Ferry Hill council seat has withdrawn, according to a filing with the city clerk.'], 'the earlier revision stays readable by number');

  rejects(app, () => item(app, BRIDGE, 3), 'not_found');
  rejects(app, () => item(app, 'it-nowhere-1'), 'not_found');
  rejects(app, () => app.call('items.get', { id: BRIDGE, revision: 0 }), 'invalid_arguments');
  rejects(app, () => app.call('items.get', {}), 'invalid_arguments');
});

test('T05 [W2] links: based_on as the publisher declared it; referenced_by on the basis, also for a copy published after a correction; nothing is labelled as outdated', () => {
  const app = fixture();
  // In the fixture the boil-water notice was copied twice and reported on by one newsroom, whose update names the corrected revision.
  assert.deepEqual(item(app, BOIL).referenced_by, [
    { item_id: 'it-round-5502', source_id: ROUNDUP, revision: 1, relation: 'copy', used_revision: 1, published_at: at('2026-11-10', '09:50'), received_at: at('2026-11-10', '09:50') },
    { item_id: 'it-cour-0897', source_id: COURIER, revision: 1, relation: 'report', used_revision: 1, published_at: at('2026-11-10', '10:50'), received_at: at('2026-11-10', '11:00') },
    { item_id: 'it-cour-0897', source_id: COURIER, revision: 2, relation: 'report', used_revision: 2, published_at: at('2026-11-11', '16:00'), received_at: at('2026-11-11', '16:10') },
    { item_id: 'it-bull-0309', source_id: BULLETIN, revision: 1, relation: 'copy', used_revision: 1, published_at: at('2026-11-11', '18:00'), received_at: at('2026-11-11', '18:00') },
  ], 'every revision that names it, in the order received, with the revision it used and its own times');
  assert.deepEqual([item(app, 'it-cour-0897').based_on, item(app, 'it-cour-0897', 1).based_on], [{ item_id: BOIL, revision: 2, relation: 'report' }, { item_id: BOIL, revision: 1, relation: 'report' }]);
  // The Bulletin's copy arrived three hours after the correction of 14:40 and still names revision 1.
  const late = item(app, 'it-bull-0309');
  assert.deepEqual([late.based_on, late.received_at, late.status, late.area_ids, item(app, BOIL, 2).received_at], [{ item_id: BOIL, revision: 1, relation: 'copy' }, at('2026-11-11', '18:00'), 'current', [MB], at('2026-11-11', '14:40')]);
  assert.deepEqual([item(app, BRIDGE).referenced_by, item(app, BRIDGE).based_on, item(app, CLINIC).referenced_by], [[], null, []]);

  // The acceptance example: the Roundup copy received on Wednesday names revision 1, and the original lists it.
  app.event(proposal('ev-it-204'));
  const copy = item(app, COPY);
  assert.deepEqual([copy.based_on, copy.source_id, copy.kind, copy.status, copy.revision, copy.received_at], [{ item_id: BRIDGE, revision: 1, relation: 'copy' }, ROUNDUP, 'notice', 'current', 1, at(WED, '06:10')]);
  assert.deepEqual(copy.effective, item(app, BRIDGE, 1).effective, 'the copy carries the period of the version it copied');
  assert.deepEqual(item(app, BRIDGE).referenced_by, [{ item_id: COPY, source_id: ROUNDUP, revision: 1, relation: 'copy', used_revision: 1, published_at: at(WED, '06:10'), received_at: at(WED, '06:10') }]);
  assert.deepEqual(item(app, BRIDGE, 1).referenced_by, item(app, BRIDGE).referenced_by, 'the list belongs to the item, whichever revision is read');
  // Nothing in Belltower updates a copy when its basis changes again.
  const stored = structuredClone(app.data.items.find(i => i.id === COPY));
  app.event(proposal('ev-it-207'));
  assert.deepEqual(app.data.items.find(i => i.id === COPY), stored);
  assert.deepEqual([item(app, COPY).based_on.revision, item(app, BRIDGE).latest_revision, item(app, BRIDGE).referenced_by[0].used_revision], [1, 3, 1]);

  // Belltower states the links and never draws the conclusion: no read result carries a verdict about a copy or a source.
  const keys = new Set();
  const collect = value => { if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.add(k); collect(v); } };
  for (const entry of app.data.items) for (const r of entry.revisions) collect(item(app, entry.id, r.number));
  for (let cursor; ;) { const pageOf = app.call('items.list', cursor ? { cursor } : {}); collect(pageOf.items); cursor = pageOf.next_cursor; if (!cursor) break; }
  collect(app.call('sources.list', {}));
  assert.deepEqual([...keys].filter(k => /outdated|stale|obsolete|duplicate|story|cluster|rank|score|trust|reliab|verified|accura/i.test(k)), []);
  assert.deepEqual([...keys].sort(), ['area_ids', 'based_on', 'body', 'changed_since_read', 'clipping_id', 'effect', 'effective', 'end', 'headline', 'id', 'is_latest', 'item_id', 'items', 'kind', 'last_read_revision', 'latest_revision',
    'matched_revisions', 'name', 'note', 'priority', 'published_at', 'read_revisions', 'received_at', 'referenced_by', 'relation', 'revision', 'revisions', 'source_id', 'source_kind', 'source_name', 'sources', 'start', 'status', 'topics', 'type', 'used_revision']);
});

test('T06 [W2] listing and search: every filter, the window over received_at, pagination; a word found only in an earlier revision is attributed to that revision', () => {
  const app = fixture(), ids = args => listed(app, args).map(i => i.id), hits = args => listed(app, args).map(i => [i.id, i.matched_revisions]);
  // Newest first, twenty to a page.
  const first = app.call('items.list', {}), second = app.call('items.list', { cursor: first.next_cursor }), third = app.call('items.list', { cursor: second.next_cursor });
  assert.deepEqual([first.items.length, first.next_cursor, second.items.length, second.next_cursor, third.items.length, third.next_cursor], [20, '20', 20, '40', 8, null]);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(i => i.id)).size, 48);
  assert.deepEqual(first.items.slice(0, 4).map(i => [i.id, i.revision, i.received_at]), [[BRIDGE, 2, at(TUE, '16:30')], ['it-bull-0312', 1, at(TUE, '12:30')], [LIBRARY, 2, at(TUE, '11:20')], ['it-ledg-0431', 1, at(TUE, '08:40')]]);
  assert.deepEqual(app.call('items.list', { limit: 2, cursor: '46' }), { items: listed(app).slice(46), next_cursor: null });
  const entry = first.items[0];
  assert.deepEqual(entry, {
    id: BRIDGE, source_id: WORKS, kind: 'notice', status: 'corrected', revision: 2, type: 'correction', headline: 'Kestrel Bridge closed for deck repairs from Wednesday', topics: ['roads'], area_ids: [MB, FH], priority: 'important',
    note: item(app, BRIDGE).note, published_at: at(TUE, '16:30'), received_at: at(TUE, '16:30'), effective: { start: at(WED, '07:00'), end: at(SAT, '18:00') }, effect: 'upcoming', based_on: null,
    matched_revisions: [1, 2], last_read_revision: 1, changed_since_read: true, clipping_id: null,
  }, 'an entry shows the item as it stands now; without a revision filter every revision matches');

  // Filters on the item.
  assert.deepEqual(ids({ source_id: CITY }), [LIBRARY, BUS, 'it-city-0201', 'it-city-0196', 'it-city-0199', 'it-city-0194', 'it-city-0190']);
  assert.deepEqual([ids({ kind: 'notice' }).length, ids({ kind: 'article' }).length], [12, 36]);
  assert.deepEqual([ids({ status: 'retracted' }), ids({ status: 'corrected' }).length, ids({ status: 'current' }).length], [['it-ledg-0421', 'it-cour-0893', 'it-bull-0304'], 8, 37]);
  assert.deepEqual(ids({ changed_since_read: true }), [BRIDGE, LIBRARY, BUS, LANE, 'it-city-0201', 'it-cour-0889', 'it-city-0194', 'it-cour-0884']);
  assert.equal(ids({ changed_since_read: false }).length, 40);
  assert.deepEqual(ids({ source_id: WORKS, kind: 'notice', status: 'corrected' }), [BRIDGE, BOIL, LANE]);

  // Filters on the revision: every revision is checked, and matched_revisions names those that pass.
  assert.deepEqual(hits({ topic: 'libraries' }), [['it-bull-0312', [1]], [LIBRARY, [1, 2]], ['it-ledg-0431', [1]], ['it-round-5517', [1]], ['it-bull-0304', [1, 2]], ['it-ledg-0415', [1, 2]]], 'a retraction counts with the topics of the revision before it');
  assert.deepEqual(hits({ min_priority: 'urgent' }), [['it-bull-0309', [1]], [BOIL, [1, 2]], ['it-round-5502', [1]]], 'the notice was urgent until it was lifted at revision 3');
  assert.deepEqual(hits({ min_priority: 'important', source_id: WORKS }), [[BRIDGE, [1, 2]], [BOIL, [1, 2, 3]], [LANE, [1, 2]], [MAIN, [1]]]);
  // Area: the same area, an area inside it or an area that contains it.
  const north = new Map(hits({ area_id: MN })), south = new Map(hits({ area_id: MS }));
  assert.deepEqual([north.get(BOIL), south.get(BOIL), north.get('it-cour-0897'), south.get('it-cour-0897')], [[1], [1, 2, 3], [1], [1, 2]], 'the notice covered Millbrook North only before its correction narrowed it');
  assert.deepEqual([north.has(MAIN), south.has(MAIN), north.has(CLINIC), south.has(CLINIC), north.has('it-city-0190'), north.has(LIBRARY)], [true, false, false, true, true, false]);
  assert.deepEqual(hits({ area_id: OQ, source_id: WORKS }), [[LANE, [2]], ['it-works-0342', [1]], ['it-works-0340', [1, 2]], ['it-water-0108', [1]]], 'the lane closure was moved to Old Quay by its correction');
  assert.deepEqual(hits({ area_id: FH, source_id: WORKS, kind: 'notice' }), [[BRIDGE, [1, 2]], [LANE, [1]]]);

  // The window is over received_at, the time a revision reached Belltower: start included, end excluded.
  assert.deepEqual(hits({ start: at(TUE, '00:00'), end: at(WED, '00:00') }), [[BRIDGE, [2]], ['it-bull-0312', [1]], [LIBRARY, [2]], ['it-ledg-0431', [1]]]);
  assert.deepEqual(hits({ start: at(TUE, '16:30'), end: at(TUE, '16:30:01') }), [[BRIDGE, [2]]]);
  assert.deepEqual(hits({ start: at(TUE, '12:30:01'), end: at(TUE, '16:30') }), []);
  assert.deepEqual(hits({ start: at('2026-11-16', '09:45'), end: at('2026-11-16', '10:00') }), [], 'the bridge notice was published at 09:45 and received at 10:00');
  assert.deepEqual(hits({ start: at('2026-11-16', '10:00'), end: at('2026-11-16', '10:01') }), [[BRIDGE, [1]]]);
  assert.deepEqual(ids({ start: at(TUE, '12:00') }), [BRIDGE, 'it-bull-0312'], 'either end may be left open');
  assert.deepEqual(ids({ end: '2026-10-26T08:30:00-05:00' }), ['it-water-0108', 'it-city-0190']);
  // In October the city is on daylight time; a window given in another offset selects the same instants.
  assert.deepEqual(ids({ start: '2026-10-26T12:00:00Z', end: '2026-10-26T13:30:00Z' }), ['it-water-0108', 'it-city-0190']);

  // Search: every word of the query, as a whole word in the headline or body of one revision, in any letter case.
  assert.deepEqual(hits({ query: 'Thursday' }), [[BRIDGE, [1]], ['it-cour-0895', [1, 2]], ['it-city-0194', [1, 2]], ['it-works-0340', [2]], ['it-ledg-0414', [1]], ['it-round-5487', [1]]], 'the corrected claim is still found, as part of revision 1');
  assert.deepEqual([hits({ query: 'Kestrel Thursday' }), hits({ query: 'thursday KESTREL' }), hits({ query: 'Kestrel, Thursday!' })], Array(3).fill([[BRIDGE, [1]]]));
  assert.deepEqual([hits({ query: 'Kestrel Wednesday' }), hits({ query: 'Kestr' }), hits({ query: 'Kestrel zeppelin' })], [[[BRIDGE, [2]]], [], []], 'whole words only, and all of them in the same revision');
  assert.deepEqual(hits({ query: 'boil', area_id: MN }), [['it-bull-0309', [1]], ['it-cour-0897', [1]], ['it-round-5502', [1]], [BOIL, [1]]], 'all revision filters are checked on the same revision');
  assert.deepEqual(hits({ query: 'published in error' }), [], 'a publisher\'s note is not searched, and a retraction has no text of its own');
  assert.deepEqual([hits({ query: 'candidate' }), hits({ query: 'undefined' }), hits({ query: 'null' })], [[['it-cour-0893', [1]]], [], []], 'the retraction itself matches no word at all');
  assert.deepEqual([hits({ query: 'Riverside clinic' }), hits({ query: 'northgate' }), hits({ query: 'board papers show' })], Array(3).fill([[CLINIC, [1]]]), 'words of the headline, of the body, or of both');
  assert.deepEqual(app.call('items.list', { query: 'zeppelin' }), { items: [], next_cursor: null }, 'no match is an empty list, not an error');

  rejects(app, () => listed(app, { source_id: 'src-nowhere' }), 'not_found');
  rejects(app, () => listed(app, { area_id: 'ar-nowhere' }), 'not_found');
  rejects(app, () => listed(app, { start: at(WED, '00:00'), end: at(TUE, '00:00') }), 'invalid_window');
  rejects(app, () => listed(app, { start: at(TUE, '00:00'), end: at(TUE, '00:00') }), 'invalid_window');
  rejects(app, () => listed(app, { query: '?!' }), 'invalid_arguments');
  rejects(app, () => listed(app, { cursor: 'abc' }), 'invalid_arguments');
  rejects(app, () => listed(app, { topic: 'sport' }), 'invalid_arguments');
  rejects(app, () => listed(app, { start: '2026-11-17 00:00' }), 'invalid_arguments');
  rejects(app, () => app.call('items.list', { limit: 101 }), 'invalid_arguments');

  // Sources and areas.
  assert.deepEqual(app.call('sources.list', {}).sources.map(s => [s.id, s.kind, s.items]), [[WORKS, 'official', 8], [CITY, 'official', 7], [COURIER, 'newsroom', 12], [LEDGER, 'newsroom', 9], [ROUNDUP, 'aggregator', 7], [BULLETIN, 'aggregator', 5]]);
  assert.deepEqual(app.call('sources.list', { kind: 'aggregator' }).sources.map(s => s.name), ['Halden Roundup', 'Neighbourhood Bulletin']);
  const areas = app.call('areas.list', {}).areas;
  assert.deepEqual([areas.length, areas.filter(a => a.level === 'city').length, areas.filter(a => a.level === 'district').length, areas.filter(a => a.level === 'neighbourhood').length], [9, 1, 3, 5]);
  assert.deepEqual(app.call('areas.list', { id: MB }).areas, [
    { id: MB, name: 'Millbrook', level: 'district', parent_id: H, path: [H, MB] }, { id: MN, name: 'Millbrook North', level: 'neighbourhood', parent_id: MB, path: [H, MB, MN] },
    { id: MS, name: 'Millbrook South', level: 'neighbourhood', parent_id: MB, path: [H, MB, MS] },
  ]);
  assert.deepEqual([app.call('areas.list', { id: H }).areas.length, app.call('areas.list', { id: QS }).areas.map(a => a.id)], [9, [QS]]);
  rejects(app, () => app.call('areas.list', { id: 'ar-nowhere' }), 'not_found');
  rejects(app, () => app.call('sources.list', { kind: 'blog' }), 'invalid_arguments');

  // None of these reads left a trace: the harness refuses a read that changes data, and no read mark appeared.
  assert.deepEqual(app.data, seedCopy());
});

test('T07 [W2] public notices: the three times; effect at the start and end boundaries and for an open-ended notice; a retracted item keeps its earlier revisions', () => {
  const app = fixture(), effect = (id, revision) => item(app, id, revision).effect;
  // At the fixture's clock all three effects exist, and an article has none.
  assert.deepEqual([effect(BRIDGE), effect(LIBRARY), effect(BOIL), effect(BUS), effect(MAIN), effect(CLINIC)], ['upcoming', 'in_effect', 'ended', 'upcoming', 'ended', null]);
  assert.deepEqual([item(app, CLINIC).effective, item(app, LIBRARY).effective, item(app, BOIL).effective], [null, { start: at(TUE, '09:00'), end: null }, { start: at('2026-11-10', '09:00'), end: at('2026-11-13', '10:00') }]);
  // The boil-water notice was open-ended until its third revision gave it an end.
  assert.deepEqual([item(app, BOIL, 1).effective.end, effect(BOIL, 1), effect(BOIL, 2)], [null, 'in_effect', 'in_effect'], 'each revision is read with the period it announced');

  // The clock moves with no event; the effect follows it. Revision 2 starts on Wednesday 07:00, revision 1 said Thursday.
  const data = JSON.stringify(app.data);
  const steps = [[at(WED, '06:59:59'), 'upcoming', 'upcoming'], [at(WED, '07:00'), 'in_effect', 'upcoming'], [at(THU, '06:59:59'), 'in_effect', 'upcoming'], [at(THU, '07:00'), 'in_effect', 'in_effect'],
    [at(SAT, '17:59:59'), 'in_effect', 'in_effect'], [at(SAT, '18:00'), 'ended', 'ended'], ['2027-11-21T18:00:00-06:00', 'ended', 'ended']];
  for (const [when, second, first] of steps) {
    app.advance(when);
    assert.deepEqual([effect(BRIDGE), effect(BRIDGE, 1), listed(app, { source_id: WORKS, start: at(TUE, '16:30') })[0].effect], [second, first, second], when);
  }
  assert.equal(effect(LIBRARY), 'in_effect', 'an open-ended notice stays in effect');
  assert.equal(JSON.stringify(app.data), data, 'time moved a year and business data is as it was');

  // An update moves the period, and the effect follows the new one (the proposal's third example).
  const later = fixture();
  later.event(proposal('ev-it-207'));
  assert.deepEqual([item(later, BRIDGE).effective, item(later, BRIDGE).effect, item(later, BRIDGE).status], [{ start: at(WED, '07:00'), end: at(FRI, '17:00') }, 'in_effect', 'corrected']);
  later.advance(at(FRI, '17:00'));
  assert.deepEqual([item(later, BRIDGE).effect, item(later, BRIDGE, 2).effect], ['ended', 'in_effect'], 'revision 2 still says Saturday 18:00');

  // A retraction (the proposal's fourth example): the note and no body; the earlier revision stays readable by number.
  const retract = proposal('ev-it-210');
  later.event({ ...retract, at: at(FRI, '17:30'), payload: { ...retract.payload, revision: { ...retract.payload.revision, published_at: at(FRI, '17:15') } } });
  const clinic = item(later, CLINIC);
  assert.deepEqual([clinic.status, clinic.type, clinic.revision, clinic.body, clinic.note, clinic.published_at, clinic.received_at], ['retracted', 'retraction', 2, null, 'This report relied on a draft that the clinic board did not adopt. Riverside Clinic is not closing.', at(FRI, '17:15'), at(FRI, '17:30')]);
  assert.deepEqual([clinic.headline, clinic.topics, clinic.area_ids, clinic.priority], ['Riverside Clinic to close in December, board papers show', ['health'], [MS], 'important']);
  assert.deepEqual([item(later, CLINIC, 1).body.startsWith('Riverside Clinic in Millbrook South will close on 18 December'), item(later, CLINIC, 1).is_latest, item(later, CLINIC, 1).status], [true, false, 'retracted']);
  rejects(later, () => later.event(updated(at(FRI, '18:00'), CLINIC, 3)), 'invalid_event');
  // A retracted notice announces nothing any more: no period and no effect, while its earlier revisions keep theirs.
  later.event(retracted(at(FRI, '18:00'), BRIDGE, 4));
  assert.deepEqual([item(later, BRIDGE).effective, item(later, BRIDGE).effect, item(later, BRIDGE, 3).effect, item(later, BRIDGE).headline], [null, null, 'ended', 'Kestrel Bridge reopens Friday evening']);
});

test('T08 [W3] read marks: at the latest and at a named revision; changed_since_read after a later revision; a repeat; an unknown revision; reads create no mark', () => {
  const app = fixture(), state = id => { const i = item(app, id); return [i.last_read_revision, i.changed_since_read, i.read_revisions]; };
  // The fixture's record, newest first: which revision the person was shown, and when.
  const all = app.call('reading.list', { limit: 100 }).marks;
  assert.deepEqual(all.map(m => [m.item_id, m.revision, m.is_latest]), [[LIBRARY, 1, false], [CLINIC, 1, true], [BRIDGE, 1, false], [BUS, 1, false], [BOIL, 3, true], [LANE, 1, false], [MAIN, 1, true], [BOIL, 2, false], [BOIL, 1, false],
    ['it-city-0201', 1, false], ['it-cour-0889', 1, false], ['it-ledg-0415', 2, true], ['it-cour-0884', 2, false], ['it-city-0194', 1, false]]);
  assert.deepEqual(all[2], { item_id: BRIDGE, revision: 1, read_at: at('2026-11-16', '10:20'), is_latest: false, latest_revision: 2 }, 'the acceptance example: read at revision 1 on Monday, corrected on Tuesday');
  assert.deepEqual(state(BRIDGE), [1, true, [1]]);
  assert.deepEqual(app.call('reading.list', { id: BOIL }).marks.map(m => [m.revision, m.read_at]), [[3, at('2026-11-13', '10:10')], [2, at('2026-11-11', '14:55')], [1, at('2026-11-10', '09:20')]]);
  const first = app.call('reading.list', { limit: 5 }), second = app.call('reading.list', { limit: 5, cursor: first.next_cursor }), third = app.call('reading.list', { limit: 5, cursor: second.next_cursor });
  assert.deepEqual([first.marks.length, first.next_cursor, second.marks.length, second.next_cursor, third.marks.length, third.next_cursor], [5, '5', 5, '10', 4, null]);
  assert.deepEqual([...first.marks, ...second.marks, ...third.marks], all);

  // A new item that no rule matches. Reading it, listing it and searching for it mark nothing.
  const quiet = { area_ids: [UF], topics: ['weather'], priority: 'routine' };
  app.event(published(at(TUE, '17:10'), 'it-test-1', quiet));
  item(app, 'it-test-1'); item(app, 'it-test-1', 1); listed(app, { query: 'headline' }); app.call('reading.list', { id: 'it-test-1' }); app.call('notifications.list', {});
  assert.equal(app.data.read_marks.length, 14, 'the record says what the person was shown, not what the Agent looked up');
  assert.deepEqual(state('it-test-1'), [null, false, []]);

  // Mark at the latest revision, with the current time.
  app.advance(at(TUE, '17:15'));
  const start = app.data.activity.length;
  assert.deepEqual(app.call('reading.mark', { id: 'it-test-1' }), { id: 'it-test-1', mark: { item_id: 'it-test-1', revision: 1, read_at: at(TUE, '17:15'), is_latest: true, latest_revision: 1 } });
  assert.deepEqual(state('it-test-1'), [1, false, [1]]);
  // A later revision arrives: the item has changed since it was read. A read mark alone brings no notification.
  app.event(corrected(at(TUE, '17:30'), 'it-test-1', 2, quiet));
  assert.deepEqual([state('it-test-1'), app.call('reading.list', { id: 'it-test-1' }).marks[0].is_latest, notifications(app).length], [[1, true, [1]], false, 12]);
  assert.ok(listed(app, { changed_since_read: true }).some(i => i.id === 'it-test-1'));
  // Mark a named revision.
  assert.deepEqual(app.call('reading.mark', { id: 'it-test-1', revision: 2 }).mark, { item_id: 'it-test-1', revision: 2, read_at: at(TUE, '17:30'), is_latest: true, latest_revision: 2 });
  assert.deepEqual(state('it-test-1'), [2, false, [1, 2]]);
  app.event(updated(at(TUE, '17:40'), 'it-test-1', 3, quiet));
  assert.deepEqual(state('it-test-1'), [2, true, [1, 2]]);

  // An earlier revision can be marked later; it does not hide the newer one that was read.
  assert.equal(app.call('reading.mark', { id: 'it-cour-0884', revision: 1 }).mark.is_latest, false);
  assert.deepEqual(state('it-cour-0884'), [2, true, [1, 2]]);
  assert.equal(app.call('reading.mark', { id: 'it-cour-0884' }).mark.revision, 3);
  assert.deepEqual(state('it-cour-0884'), [3, false, [1, 2, 3]]);
  // A retraction is a revision like any other and can be marked as read.
  assert.deepEqual([app.call('reading.mark', { id: 'it-cour-0893' }).mark.revision, state('it-cour-0893')], [2, [2, false, [2]]]);
  assert.deepEqual(app.data.activity.slice(start).filter(a => a.actor === 'agent').map(a => [a.action, a.object_id, a.details]),
    [['reading.mark', 'it-test-1', { revision: 1 }], ['reading.mark', 'it-test-1', { revision: 2 }], ['reading.mark', 'it-cour-0884', { revision: 1 }], ['reading.mark', 'it-cour-0884', { revision: 3 }], ['reading.mark', 'it-cour-0893', { revision: 2 }]]);

  // A repeat, an unknown revision, an unknown item.
  rejects(app, () => app.call('reading.mark', { id: 'it-test-1', revision: 2 }), 'already_read');
  rejects(app, () => app.call('reading.mark', { id: BRIDGE, revision: 1 }), 'already_read');
  rejects(app, () => app.call('reading.mark', { id: BOIL }), 'already_read');
  rejects(app, () => app.call('reading.mark', { id: 'it-test-1', revision: 4 }), 'not_found');
  rejects(app, () => app.call('reading.mark', { id: 'it-nowhere-1' }), 'not_found');
  rejects(app, () => app.call('reading.list', { id: 'it-nowhere-1' }), 'not_found');
  rejects(app, () => app.call('reading.mark', { id: BRIDGE, revision: 0 }), 'invalid_arguments');
  rejects(app, () => app.call('reading.mark', { revision: 1 }), 'invalid_arguments');
  rejects(app, () => app.call('reading.list', { cursor: '-1' }), 'invalid_arguments');
  assert.equal(app.call('reading.mark', { id: BRIDGE }).mark.revision, 2);
  assert.deepEqual(state(BRIDGE), [2, false, [1, 2]]);
});

test('T09 [W3] clippings: add at the current revision with a note and a linked_object; a duplicate; is_current turns false when a revision arrives', () => {
  const app = fixture();
  const all = app.call('clippings.list', {}).clippings;
  assert.deepEqual(all.map(c => [c.id, c.item_id, c.revision, c.latest_revision, c.is_current, c.state, c.watch, c.history.length]),
    [['clp-0004', LIBRARY, 1, 2, false, 'behind', false, 0], ['clp-0003', CLINIC, 1, 1, true, 'current', true, 0], ['clp-0002', 'it-ledg-0427', 1, 1, true, 'current', false, 0], ['clp-0001', BOIL, 3, 3, true, 'current', true, 2]]);
  assert.deepEqual(all[0], {
    id: 'clp-0004', item_id: LIBRARY, revision: 1, latest_revision: 2, is_current: false, state: 'behind', note: 'Study group on Tuesday, 19:30 at Old Quay Library.',
    linked_object: { app_id: 'calendar', object_type: 'event', object_id: 'evt-study-group-1117' }, watch: false, created_at: at('2026-11-16', '19:45'), updated_at: null, history: [],
  }, 'the plan was built on the first announcement, and the clipping says so');
  assert.deepEqual([all[2].note, all[2].linked_object, all[3].updated_at], ['Cheese stall is back. Go before 11.', null, at('2026-11-13', '10:15')]);
  const ids = args => app.call('clippings.list', args).clippings.map(c => c.id);
  assert.deepEqual([ids({ state: 'behind' }), ids({ state: 'current' }), ids({ id: BOIL }), ids({ id: BRIDGE }), ids({ id: LIBRARY, state: 'current' })], [['clp-0004'], ['clp-0003', 'clp-0002', 'clp-0001'], ['clp-0001'], [], []]);

  // The acceptance example: clip the bridge notice with a note and a Calendar event reference.
  const start = app.data.activity.length, linked = { app_id: 'calendar', object_type: 'event', object_id: 'evt-early-shift-1119' };
  const made = app.call('clippings.add', { id: BRIDGE, note: 'Early shift on Thursday. Leave by 05:40 while the bridge is shut.', linked_object: linked });
  assert.deepEqual(made, { id: 'clp-0005', clipping: {
    id: 'clp-0005', item_id: BRIDGE, revision: 2, latest_revision: 2, is_current: true, state: 'current', note: 'Early shift on Thursday. Leave by 05:40 while the bridge is shut.',
    linked_object: linked, watch: false, created_at: CLOCK, updated_at: null, history: [],
  } });
  assert.deepEqual([item(app, BRIDGE).clipping_id, listed(app, { source_id: WORKS })[0].clipping_id, ids({})[0]], ['clp-0005', 'clp-0005', 'clp-0005']);
  assert.deepEqual(app.data.activity.slice(start).map(a => [a.actor, a.action, a.object_id, a.details]), [['agent', 'clippings.add', 'clp-0005', { item_id: BRIDGE, revision: 2, watch: false }]]);
  // The reference is stored as given and never opened: it need not exist anywhere.
  assert.deepEqual(app.data.clippings.at(-1).linked_object, linked);
  // A clipping without a note, watched from the start.
  const plain = app.call('clippings.add', { id: 'it-ledg-0431', watch: true }).clipping;
  assert.deepEqual([plain.id, plain.note, plain.linked_object, plain.watch], ['clp-0006', null, null, true]);

  // Twice, unknown, malformed.
  rejects(app, () => app.call('clippings.add', { id: BRIDGE }), 'already_clipped');
  rejects(app, () => app.call('clippings.add', { id: LIBRARY, note: 'again' }), 'already_clipped');
  rejects(app, () => app.call('clippings.add', { id: 'it-nowhere-1' }), 'not_found');
  rejects(app, () => app.call('clippings.list', { id: 'it-nowhere-1' }), 'not_found');
  rejects(app, () => app.call('clippings.add', { id: MAIN, linked_object: { app_id: 'calendar', object_id: 'evt-1' } }), 'invalid_arguments');
  rejects(app, () => app.call('clippings.add', { id: MAIN, note: '' }), 'invalid_arguments');
  rejects(app, () => app.call('clippings.add', { id: MAIN, revision: 1 }), 'invalid_arguments');
  rejects(app, () => app.call('clippings.list', { state: 'removed' }), 'invalid_arguments');

  // The next revision of the bridge notice arrives: the clipping is behind, and the stored clipping is as it was.
  const stored = structuredClone(app.data.clippings.find(c => c.id === 'clp-0005'));
  app.event(proposal('ev-it-207'));
  const behind = clipping(app, 'clp-0005');
  assert.deepEqual([behind.revision, behind.latest_revision, behind.is_current, behind.state, behind.updated_at], [2, 3, false, 'behind', null]);
  assert.deepEqual(app.data.clippings.find(c => c.id === 'clp-0005'), stored, 'behind is read from the item, nothing is rewritten');
  assert.deepEqual(ids({ state: 'behind' }), ['clp-0005', 'clp-0004']);
});

test('T10 [W3] clipping history: move forward, change the note and the watch setting, each kept in history; moving back; removing; the limit of 100', () => {
  const app = fixture(), LINKED = { app_id: 'calendar', object_type: 'event', object_id: 'evt-study-group-1117' };
  // The fixture's first clipping followed the boil-water notice through its three revisions.
  assert.deepEqual(clipping(app, 'clp-0001').history, [
    { replaced_at: at('2026-11-11', '15:00'), revision: 1, note: 'Dad\'s street, Alder Row, is in Millbrook South. Call him.', watch: true, request_id: 'req-0012' },
    { replaced_at: at('2026-11-13', '10:15'), revision: 2, note: 'Corrected: Millbrook South only. Dad still has to boil.', watch: true, request_id: 'req-0018' },
  ]);

  // The acceptance example: move the clipping to revision 2 with a new note; revision 1 and the first note are in its history.
  app.advance(at(TUE, '17:10'));
  const start = app.data.activity.length;
  const moved = app.call('clippings.update', { id: 'clp-0004', patch: { revision: 2, note: 'Library shuts at 19:00. Meet at 18:00 instead.' } });
  assert.deepEqual(moved, { id: 'clp-0004', clipping: {
    id: 'clp-0004', item_id: LIBRARY, revision: 2, latest_revision: 2, is_current: true, state: 'current', note: 'Library shuts at 19:00. Meet at 18:00 instead.', linked_object: LINKED, watch: false,
    created_at: at('2026-11-16', '19:45'), updated_at: at(TUE, '17:10'),
    history: [{ replaced_at: at(TUE, '17:10'), revision: 1, note: 'Study group on Tuesday, 19:30 at Old Quay Library.', linked_object: LINKED, watch: false, request_id: 'unit-1' }],
  } });
  // The watch setting.
  app.advance(at(TUE, '17:12'));
  const watched = app.call('clippings.update', { id: 'clp-0004', patch: { watch: true } }).clipping;
  assert.deepEqual([watched.watch, watched.revision, watched.note, watched.history.length, watched.history[1]], [true, 2, 'Library shuts at 19:00. Meet at 18:00 instead.', 2,
    { replaced_at: at(TUE, '17:12'), revision: 2, note: 'Library shuts at 19:00. Meet at 18:00 instead.', linked_object: LINKED, watch: false, request_id: 'unit-2' }]);
  // null removes the note or the reference; the version before is kept.
  app.advance(at(TUE, '17:14'));
  const bare1 = app.call('clippings.update', { id: 'clp-0004', patch: { note: null } }).clipping;
  assert.deepEqual([bare1.note, bare1.linked_object, bare1.history.length, bare1.history[2].note, bare1.history[2].watch], [null, LINKED, 3, 'Library shuts at 19:00. Meet at 18:00 instead.', true]);
  const bare2 = app.call('clippings.update', { id: 'clp-0004', patch: { linked_object: null } }).clipping;
  assert.deepEqual([bare2.note, bare2.linked_object, bare2.history.length, 'note' in bare2.history[3], bare2.history[3].linked_object], [null, null, 4, false, LINKED]);
  assert.deepEqual(Object.keys(app.data.clippings.find(c => c.id === 'clp-0004')), ['id', 'item_id', 'revision', 'watch', 'created_at', 'history']);
  // A patch that changes nothing is committed and adds no history row.
  const same = app.call('clippings.update', { id: 'clp-0004', patch: { watch: true, note: null } }).clipping;
  assert.deepEqual([same.history.length, same.updated_at], [4, at(TUE, '17:14')]);
  // Several fields in one patch are one change.
  app.advance(at(TUE, '17:16'));
  const several = app.call('clippings.update', { id: 'clp-0004', patch: { note: 'Back to the plan.', watch: false, linked_object: LINKED } }).clipping;
  assert.deepEqual([several.note, several.watch, several.linked_object, several.history.length, several.updated_at], ['Back to the plan.', false, LINKED, 5, at(TUE, '17:16')]);
  assert.deepEqual(Object.keys(app.data.clippings.find(c => c.id === 'clp-0004')), ['id', 'item_id', 'revision', 'note', 'linked_object', 'watch', 'created_at', 'history'], 'stored fields keep their order');
  assert.deepEqual(app.data.activity.slice(start).map(a => [a.action, a.object_id, a.details.fields, a.details.changed, a.details.revision]), [
    ['clippings.update', 'clp-0004', ['revision', 'note'], ['revision', 'note'], 2], ['clippings.update', 'clp-0004', ['watch'], ['watch'], 2], ['clippings.update', 'clp-0004', ['note'], ['note'], 2],
    ['clippings.update', 'clp-0004', ['linked_object'], ['linked_object'], 2], ['clippings.update', 'clp-0004', ['watch', 'note'], [], 2], ['clippings.update', 'clp-0004', ['note', 'watch', 'linked_object'], ['note', 'watch', 'linked_object'], 2],
  ]);

  // Moving back, staying, a revision the item does not have, an empty patch, an unknown clipping.
  rejects(app, () => app.call('clippings.update', { id: 'clp-0004', patch: { revision: 1 } }), 'invalid_revision');
  rejects(app, () => app.call('clippings.update', { id: 'clp-0004', patch: { revision: 2, note: 'same revision' } }), 'invalid_revision');
  rejects(app, () => app.call('clippings.update', { id: 'clp-0001', patch: { revision: 2 } }), 'invalid_revision');
  rejects(app, () => app.call('clippings.update', { id: 'clp-0004', patch: { revision: 3 } }), 'not_found');
  rejects(app, () => app.call('clippings.update', { id: 'clp-0004', patch: {} }), 'invalid_arguments');
  rejects(app, () => app.call('clippings.update', { id: 'clp-0099', patch: { watch: true } }), 'not_found');
  rejects(app, () => app.call('clippings.update', { id: 'clp-0004', patch: { revision: 0 } }), 'invalid_arguments');
  rejects(app, () => app.call('clippings.update', { id: 'clp-0004', patch: { colour: 'red' } }), 'invalid_arguments');
  rejects(app, () => app.call('clippings.update', { id: 'clp-0004' }), 'invalid_arguments');

  // Forward one revision at a time: a clipping that is moved, but not to the latest revision, stays behind.
  const quiet = { area_ids: [UF], topics: ['weather'], priority: 'routine' };
  app.event(published(at(TUE, '17:20'), 'it-test-1', quiet));
  const id = app.call('clippings.add', { id: 'it-test-1', note: 'first' }).id;
  app.event(updated(at(TUE, '17:25'), 'it-test-1', 2, quiet));
  app.event(corrected(at(TUE, '17:30'), 'it-test-1', 3, quiet));
  assert.deepEqual([id, clipping(app, id).revision, clipping(app, id).latest_revision, clipping(app, id).state], ['clp-0005', 1, 3, 'behind']);
  const middle = app.call('clippings.update', { id, patch: { revision: 2 } }).clipping;
  assert.deepEqual([middle.revision, middle.is_current, middle.state], [2, false, 'behind']);
  const last = app.call('clippings.update', { id, patch: { revision: 3, note: 'third' } }).clipping;
  assert.deepEqual([last.revision, last.is_current, last.state, last.history.map(v => [v.revision, v.note])], [3, true, 'current', [[1, 'first'], [2, 'first']]]);
  assert.equal(notifications(app).length, 12, 'an unwatched clipping brings no notification');

  // Remove: the clipping and its history go; the item and its read marks stay. The ID does not come back.
  app.call('reading.mark', { id: 'it-test-1' });
  const items = JSON.stringify(app.data.items), marks = JSON.stringify(app.data.read_marks);
  assert.deepEqual(app.call('clippings.remove', { id }), { id: 'clp-0005', remaining: 4 });
  assert.deepEqual([clipping(app, id), item(app, 'it-test-1').clipping_id, JSON.stringify(app.data.items) === items, JSON.stringify(app.data.read_marks) === marks], [undefined, null, true, true]);
  rejects(app, () => app.call('clippings.remove', { id }), 'not_found');
  rejects(app, () => app.call('clippings.update', { id, patch: { watch: true } }), 'not_found');
  const again = app.call('clippings.add', { id: 'it-test-1' }).clipping;
  assert.deepEqual([again.id, again.revision, again.is_current, again.note, again.history], ['clp-0006', 3, true, null, []]);
  assert.deepEqual(actions(app).slice(-3), ['agent:reading.mark:it-test-1', 'agent:clippings.remove:clp-0005', 'agent:clippings.add:clp-0006']);

  // The limit of 100.
  const many = fixture({ seed: seedWith(seed => {
    for (let i = 1; i <= 97; i++) {
      const extra = 'it-extra-' + String(i).padStart(3, '0');
      seed.items.push({ id: extra, source_id: LEDGER, kind: 'article', revisions: [{ number: 1, type: 'original', published_at: at('2026-11-02', '09:00'), received_at: at('2026-11-02', '09:00'), headline: 'Extra ' + i, body: 'Extra item ' + i + '.', topics: ['community'], area_ids: [OQ], priority: 'routine' }] });
      if (i <= 96) seed.clippings.push({ id: 'clp-1' + String(i).padStart(3, '0'), item_id: extra, revision: 1, watch: false, created_at: at('2026-11-03', '09:00'), history: [] });
    }
  }) });
  assert.equal(many.call('clippings.list', {}).clippings.length, 100);
  rejects(many, () => many.call('clippings.add', { id: 'it-extra-097' }), 'limit_exceeded');
  rejects(many, () => many.call('clippings.add', { id: LIBRARY }), 'already_clipped');
  assert.equal(many.call('clippings.remove', { id: 'clp-1096' }).remaining, 99);
  assert.equal(many.call('clippings.add', { id: 'it-extra-097' }).id, 'clp-1097');
  rejects(many, () => many.call('clippings.add', { id: 'it-extra-096' }), 'limit_exceeded');
});

test('T11 [W4] invalid events leave state unchanged: a duplicate item, a wrong revision number, a wrong publication time, a retracted or unknown item, a missing basis, an effective period on an article', () => {
  const app = fixture(), W = at(WED, '10:00');
  let refused = 0;
  const bad = (event, code = 'invalid_event') => { rejects(app, () => app.event(event), code); refused++; };
  const link = (item_id, revision, relation = 'copy') => ({ based_on: { item_id, revision, relation } });
  // A duplicate item: the ID of any record in use.
  for (const id of [BRIDGE, 'it-cour-0893', 'fl-0001', 'clp-0001', 'ntf-0001', 'src-works', 'ar-halden']) bad(published(W, id));
  // An unknown source or area.
  bad(published(W, 'it-test-1', { source_id: 'src-nowhere' }));
  bad(published(W, 'it-test-1', { area_ids: [MB, 'ar-nowhere'] }));
  bad(updated(W, BRIDGE, 3, { area_ids: ['ar-nowhere'] }));
  bad(corrected(W, BRIDGE, 3, { area_ids: ['src-works'] }));
  // A revision number that is not the next one.
  bad(published(W, 'it-test-1', { number: 2 }));
  for (const number of [1, 2, 4]) { bad(updated(W, BRIDGE, number)); bad(corrected(W, BRIDGE, number)); bad(retracted(W, BRIDGE, number)); }
  // A publication time later than the event, or earlier than the revision before.
  bad(published(W, 'it-test-1', { published_at: at(WED, '10:00:01') }));
  bad(updated(W, BRIDGE, 3, { published_at: at(WED, '10:00:01') }));
  bad(retracted(W, BRIDGE, 3, { published_at: at(THU, '10:00') }));
  bad(updated(W, BRIDGE, 3, { published_at: at(TUE, '16:29:59') }));
  bad(corrected(W, BRIDGE, 3, { published_at: at('2026-11-16', '09:45') }));
  bad(retracted(W, BRIDGE, 3, { published_at: at(TUE, '16:00') }));
  // A revision of an unknown item, or of a retracted one.
  for (const id of ['it-nowhere-1', 'fl-0001']) { bad(updated(W, id, 2)); bad(corrected(W, id, 2)); bad(retracted(W, id, 2)); }
  for (const id of ['it-cour-0893', 'it-bull-0304']) { bad(updated(W, id, 3)); bad(corrected(W, id, 3)); bad(retracted(W, id, 3)); }
  // A basis that does not exist, or the item itself.
  bad(published(W, 'it-test-1', link('it-nowhere-1', 1)));
  bad(published(W, 'it-test-1', link(BRIDGE, 3)));
  bad(published(W, 'it-test-1', link('it-test-1', 1)));
  bad(updated(W, BRIDGE, 3, link(BRIDGE, 1, 'report')));
  bad(corrected(W, LANE, 3, link(BRIDGE, 9, 'report')));
  // An effective period on an article, or one that does not end after it starts.
  bad(published(W, 'it-test-1', { effective: { start: W, end: null } }));
  bad(updated(W, CLINIC, 2, { topics: ['health'], area_ids: [MS], effective: { start: W, end: at(THU, '10:00') } }));
  bad(published(W, 'it-test-1', { kind: 'notice', effective: { start: at(THU, '07:00'), end: at(THU, '06:59:59') } }));
  bad(updated(W, BRIDGE, 3, { effective: { start: at(THU, '07:00'), end: at(THU, '07:00') } }));
  // An event dated before the current time (Core's rule; the harness applies it as Core does).
  bad(published(at(TUE, '16:59:59'), 'it-test-1'));
  bad(updated(at('2026-11-16', '12:00'), BRIDGE, 3));
  assert.equal(refused, 50);

  // Shapes the event schema refuses never reach the App: Core answers invalid_arguments.
  const edit = (event, change) => { change(event.payload.revision, event.payload, event); return event; };
  const shapes = [
    edit(corrected(W, BRIDGE, 3), r => { delete r.note; }), edit(retracted(W, BRIDGE, 3), r => { delete r.note; }), edit(updated(W, BRIDGE, 3), r => { r.note = 'An update has no note.'; }),
    edit(published(W, 'it-test-1'), r => { r.note = 'An original has no note.'; }), edit(retracted(W, BRIDGE, 3), r => { r.headline = 'A retraction has no text.'; }), edit(retracted(W, BRIDGE, 3), r => { r.topics = ['roads']; }),
    edit(published(W, 'it-test-1'), r => { delete r.body; }), edit(published(W, 'it-test-1'), r => { r.topics = []; }), edit(published(W, 'it-test-1'), r => { r.topics = ['sport']; }), edit(published(W, 'it-test-1'), r => { r.area_ids = []; }),
    edit(published(W, 'it-test-1'), r => { r.priority = 'high'; }), edit(published(W, 'it-test-1'), r => { r.number = 0; }), edit(published(W, 'it-test-1'), r => { r.published_at = '2026-11-18T10:00:00'; }),
    edit(published(W, 'it-test-1'), r => { r.based_on = { item_id: BRIDGE, revision: 1, relation: 'quote' }; }), edit(published(W, 'it-test-1'), r => { r.effective = { start: W }; }),
    edit(published(W, 'it-test-1'), (r, p) => { p.kind = 'post'; }), edit(published(W, 'it-test-1'), (r, p) => { delete p.source_id; }), edit(updated(W, BRIDGE, 3), (r, p) => { p.source_id = WORKS; }),
    edit(published(W, 'it-test-1'), (r, p, e) => { e.at = '2026-11-18T10:00:00'; }), edit(published(W, 'it-test-1'), (r, p, e) => { delete e.event_id; }), edit(published(W, 'it-test-1'), (r, p, e) => { e.operation = 'belltower.item.deleted'; }),
    edit(published(W, 'it-test-1'), (r, p, e) => { e.operation = 'belltower.clock.tick'; }),
  ];
  for (const shape of shapes) rejects(app, () => app.event(shape), 'invalid_arguments');
  assert.equal(shapes.length, 22);

  // The counterparts are accepted, so each refusal above is about the fault it names.
  const start = app.data.activity.length;
  app.event(published(W, 'it-test-1', { kind: 'notice', published_at: at(WED, '09:00'), topics: ['weather'], area_ids: [UF], priority: 'routine', effective: { start: at(THU, '07:00'), end: null }, ...link(BRIDGE, 1, 'report') }));
  app.event(updated(W, 'it-test-1', 2, { published_at: at(WED, '09:00'), topics: ['weather'], area_ids: [UF], priority: 'routine', ...link(BRIDGE, 2, 'report') }));
  app.event(retracted(at(WED, '10:00:01'), 'it-test-1', 3, { published_at: at(WED, '09:00') }));
  assert.deepEqual([item(app, 'it-test-1').status, item(app, 'it-test-1', 2).based_on.revision, item(app, 'it-test-1', 2).received_at, item(app, 'it-test-1', 2).effective], ['retracted', 2, W, null]);
  assert.deepEqual(actions(app, start), ['event:item.published:it-test-1', 'event:item.updated:it-test-1', 'event:item.retracted:it-test-1']);
  assert.deepEqual(item(app, BRIDGE).referenced_by.map(r => [r.item_id, r.revision, r.used_revision, r.relation]), [['it-test-1', 1, 1, 'report'], ['it-test-1', 2, 2, 'report']]);
});

test('T12 [W4] a new item: one notification when rules match, naming them; immediate wins over digest; none without a match or under a paused rule', () => {
  const app = fixture({ seed: bare() });
  const digest = app.call('follows.create', { area_ids: [MB], delivery: 'digest' }).id;
  const immediate = app.call('follows.create', { topics: ['roads'], min_priority: 'important', delivery: 'immediate' }).id;
  const paused = app.call('follows.create', { source_ids: [COURIER], delivery: 'immediate' }).id;
  app.call('follows.update', { id: paused, patch: { paused: true } });
  assert.deepEqual([digest, immediate, paused], ['fl-0001', 'fl-0002', 'fl-0003']);

  // Both active rules match: exactly one notification, which names both; the immediate rule decides the delivery.
  const start = app.data.activity.length;
  app.event(published(at(WED, '10:00'), 'it-test-1', { area_ids: [MN], topics: ['roads'], priority: 'important' }));
  const text = 'Halden Public Works published an article on 18 November: Headline 1 of it-test-1. This is revision 1. Open Belltower for the full text.';
  assert.deepEqual(notifications(app), [{
    id: 'ntf-0001', kind: 'item.published', state: 'released', item_id: 'it-test-1', revision: 1, created_at: at(WED, '10:00'), release_at: at(WED, '10:00'), delivery: 'immediate',
    reasons: ['follow'], matched_follow_ids: [digest, immediate], supersedes: null, superseded_by: null, title: 'Headline 1 of it-test-1', body: text, email_prepared: true,
  }]);
  assert.deepEqual(app.data.activity.slice(start).map(a => [a.seq, a.at, a.actor, a.action, a.object_id, a.event_id === app.data.activity[start].event_id, a.details]), [
    [5, at(WED, '10:00'), 'event', 'item.published', 'it-test-1', true, { revision: 1, type: 'original' }],
    [6, at(WED, '10:00'), 'event', 'notification.created', 'ntf-0001', true, { kind: 'item.published', item_id: 'it-test-1', revision: 1, delivery: 'immediate', release_at: at(WED, '10:00'), reasons: ['follow'] }],
  ], 'one row for the event and one for its effect, joined by the event ID');
  assert.deepEqual([app.data.notifications[0].seq, app.data.notifications[0].cause], [6, { event_id: app.data.activity[start].event_id }]);
  // The wire message for Mail is stored with it: addressed by person_ref, dated at the release time, under the first matching rule.
  assert.deepEqual(app.data.notifications[0].wire, {
    specversion: '1.0', id: 'ntf-0001', source: 'urn:pale:app:belltower:account:belltower-dana', type: 'org.pale.mail.notification.v1', time: at(WED, '10:00'), datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email', recipient: { kind: 'person_ref', id: 'person-dana' }, source_object: { app_id: 'belltower', account_id: 'belltower-dana', object_type: 'item', object_id: 'it-test-1' },
      content: { title: 'Headline 1 of it-test-1', body: { format: 'text/plain', text }, asset_ids: [] }, subscription_ref: 'belltower-dana:fl-0001', extensions: [],
    },
  });

  // Only the digest rule matches: the notification waits for the 18:00 digest, and its wire message is dated then.
  app.event(published(at(WED, '10:05'), 'it-test-2', { kind: 'notice', area_ids: [MB], topics: ['water'], priority: 'routine' }));
  assert.deepEqual(brief(newest(app)), ['item.published', 'it-test-2', 1, 'held', 'digest', at(WED, '18:00'), 'follow', digest]);
  assert.deepEqual([newest(app).body, app.data.notifications[1].wire.time], ['Halden Public Works published a notice on 18 November: Headline 1 of it-test-2. This is revision 1. Open Belltower for the full text.', at(WED, '18:00')]);

  // No notification: no rule matches, the item is below the rule's minimum priority, or its only rule is paused.
  app.event(published(at(WED, '10:10'), 'it-test-3', { area_ids: [FH], topics: ['water'], priority: 'urgent' }));
  app.event(published(at(WED, '10:11'), 'it-test-4', { area_ids: [FH], topics: ['roads'], priority: 'routine' }));
  app.event(published(at(WED, '10:12'), 'it-test-5', { source_id: COURIER, area_ids: [OQ], topics: ['health'], priority: 'urgent' }));
  assert.equal(notifications(app).length, 2);
  assert.deepEqual(actions(app).slice(-3), ['event:item.published:it-test-3', 'event:item.published:it-test-4', 'event:item.published:it-test-5'], 'the event is applied and logged; it has no further effect');
  assert.deepEqual(listed(app, { start: at(WED, '10:10') }).map(i => i.id), ['it-test-5', 'it-test-4', 'it-test-3'], 'the items are there to be read all the same');
  // The paused rule is resumed: the same kind of item now notifies. Nothing reaches back to what was already published.
  app.call('follows.update', { id: paused, patch: { paused: false } });
  assert.equal(notifications(app).length, 2);
  app.event(published(at(WED, '10:20'), 'it-test-6', { source_id: COURIER, area_ids: [OQ], topics: ['health'], priority: 'routine' }));
  assert.deepEqual(brief(newest(app)), ['item.published', 'it-test-6', 1, 'released', 'immediate', at(WED, '10:20'), 'follow', paused]);
  assert.equal(newest(app).body, 'The Halden Courier published an article on 18 November: Headline 1 of it-test-6. This is revision 1. Open Belltower for the full text.');
  app.call('follows.create', { area_ids: [FH], delivery: 'immediate' });
  assert.equal(notifications(app).length, 3, 'a new rule applies to what arrives from now on');
  // Filters of notifications.list.
  assert.deepEqual([notifications(app, { state: 'held' }).map(n => n.id), notifications(app, { state: 'released' }).map(n => n.id), notifications(app, { id: 'it-test-6' }).map(n => n.id), notifications(app, { kind: 'item.updated' })], [['ntf-0002'], ['ntf-0001', 'ntf-0003'], ['ntf-0003'], []]);
  assert.deepEqual([notifications(app, { start: at(WED, '10:05') }).map(n => n.id), notifications(app, { end: at(WED, '10:05') }).map(n => n.id), notifications(app, { start: at(WED, '10:00'), end: at(WED, '10:20') }).map(n => n.id)],
    [['ntf-0002', 'ntf-0003'], ['ntf-0001'], ['ntf-0001', 'ntf-0002']], 'a window over the creation time: start included, end excluded');
  assert.deepEqual([app.call('notifications.list', { limit: 2 }).next_cursor, app.call('notifications.list', { limit: 2, cursor: '2' }).notifications.map(n => n.id)], ['2', ['ntf-0001']]);
  rejects(app, () => app.call('notifications.list', { id: 'it-nowhere-1' }), 'not_found');
  rejects(app, () => app.call('notifications.list', { start: at(WED, '10:05'), end: at(WED, '10:05') }), 'invalid_window');
  rejects(app, () => app.call('notifications.list', { state: 'sent' }), 'invalid_arguments');
});

test('T13 [W4] revisions: whoever was told is told again; a watched clipping alone is enough, a read mark or an unwatched clipping is not; pausing or removing a rule and ending a watch stop discovery, not corrections', () => {
  const app = fixture({ seed: bare() }), count = () => notifications(app).length, subscription = () => app.data.notifications.at(-1).wire.data.subscription_ref;
  const rule = app.call('follows.create', { area_ids: [MN], delivery: 'immediate' }).id;
  // The acceptance example: an important item matches an immediate rule at 10:00; its correction at 16:30
  // narrows the area so that no rule matches any more. Still one notification, with no matching rule listed.
  app.event(published(at(WED, '10:00'), 'it-test-a', { area_ids: [MB] }));
  app.event(corrected(at(WED, '16:30'), 'it-test-a', 2, { area_ids: [MS] }));
  assert.deepEqual(notifications(app).map(brief), [
    ['item.published', 'it-test-a', 1, 'released', 'immediate', at(WED, '10:00'), 'follow', rule],
    ['item.corrected', 'it-test-a', 2, 'released', 'immediate', at(WED, '16:30'), 'earlier_notification', ''],
  ]);
  assert.equal(newest(app).body, 'Halden Public Works corrected its article of 18 November. Publisher\'s note: Correction 2 of it-test-a. This is revision 2. Open Belltower for the full text and the earlier version.');
  assert.equal(subscription(), 'belltower-dana:earlier-notification');
  // And again for every later revision, whatever its type.
  app.event(updated(at(WED, '16:40'), 'it-test-a', 3, { area_ids: [MS] }));
  app.event(retracted(at(WED, '16:50'), 'it-test-a', 4));
  assert.deepEqual(notifications(app).slice(2).map(brief), [
    ['item.updated', 'it-test-a', 3, 'released', 'immediate', at(WED, '16:40'), 'earlier_notification', ''],
    ['item.retracted', 'it-test-a', 4, 'released', 'immediate', at(WED, '16:50'), 'earlier_notification', ''],
  ]);
  assert.deepEqual(notifications(app).slice(2).map(n => [n.title, n.body]), [
    ['Update: Headline 3 of it-test-a', 'Halden Public Works updated its article of 18 November: Headline 3 of it-test-a. This is revision 3. Open Belltower for the full text and the earlier versions.'],
    ['Retracted: Headline 3 of it-test-a', 'Halden Public Works retracted its article of 18 November. Publisher\'s note: Retraction of it-test-a. This is revision 4. Open Belltower for the earlier versions.'],
  ]);

  // A revision that matches a rule for the first time notifies; the kind follows the revision.
  app.event(published(at(WED, '17:00'), 'it-test-b', { area_ids: [FH] }));
  assert.equal(count(), 4);
  app.event(updated(at(WED, '17:10'), 'it-test-b', 2, { area_ids: [FH, MN] }));
  assert.deepEqual(brief(newest(app)), ['item.updated', 'it-test-b', 2, 'released', 'immediate', at(WED, '17:10'), 'follow', rule]);

  // A read mark or an unwatched clipping alone brings no notification.
  app.event(published(at(WED, '17:20'), 'it-test-c', { area_ids: [OQ] }));
  app.call('reading.mark', { id: 'it-test-c' });
  const kept = app.call('clippings.add', { id: 'it-test-c', note: 'kept, not watched' }).id;
  app.event(corrected(at(WED, '17:30'), 'it-test-c', 2, { area_ids: [OQ] }));
  assert.equal(count(), 5);
  // A watched clipping alone is enough, and it is delivered at once.
  app.call('clippings.update', { id: kept, patch: { watch: true } });
  app.event(updated(at(WED, '17:40'), 'it-test-c', 3, { area_ids: [OQ] }));
  assert.deepEqual(brief(newest(app)), ['item.updated', 'it-test-c', 3, 'released', 'immediate', at(WED, '17:40'), 'watched_clipping', '']);
  assert.equal(subscription(), 'belltower-dana:' + kept);
  // A watch follows the revisions of the clipped item only: a new item that names it as its basis
  // brings no notification through the watch (the plan's third open question, settled in review).
  app.event(published(at(WED, '17:45'), 'it-test-c2', { source_id: COURIER, area_ids: [OQ], based_on: { item_id: 'it-test-c', revision: 3, relation: 'report' } }));
  assert.deepEqual([count(), item(app, 'it-test-c').referenced_by.map(r => [r.item_id, r.used_revision])], [6, [['it-test-c2', 3]]]);
  // Ending the watch does not stop later revisions of this item: the account was told, so it is told again.
  app.call('clippings.update', { id: kept, patch: { watch: false } });
  app.event(corrected(at(WED, '17:50'), 'it-test-c', 4, { area_ids: [OQ] }));
  assert.deepEqual(brief(newest(app)), ['item.corrected', 'it-test-c', 4, 'released', 'immediate', at(WED, '17:50'), 'earlier_notification', '']);
  // It does stop what depended on the watch alone: an item that was watched and never notified.
  app.event(published(at(WED, '18:00'), 'it-test-d', { area_ids: [OQ] }));
  const watch = app.call('clippings.add', { id: 'it-test-d', watch: true }).id;
  app.call('clippings.update', { id: watch, patch: { watch: false } });
  app.event(updated(at(WED, '18:10'), 'it-test-d', 2, { area_ids: [OQ] }));
  app.call('clippings.update', { id: watch, patch: { watch: true } });
  app.call('clippings.remove', { id: watch });
  app.event(updated(at(WED, '18:20'), 'it-test-d', 3, { area_ids: [OQ] }));
  assert.equal(count(), 7, 'neither the ended watch nor the removed clipping notifies');

  // Pausing a rule stops discovery through it: a new item brings nothing, and a revision of an item the
  // account was never told about brings nothing. A revision of an item notified earlier still notifies.
  app.event(published(at(WED, '18:30'), 'it-test-e', { area_ids: [MN] }));
  assert.deepEqual(brief(newest(app)).slice(0, 2).concat(newest(app).matched_follow_ids), ['item.published', 'it-test-e', rule]);
  app.call('follows.update', { id: rule, patch: { paused: true } });
  app.event(published(at(WED, '18:40'), 'it-test-f', { area_ids: [MN] }));
  app.event(updated(at(WED, '18:45'), 'it-test-f', 2, { area_ids: [MN] }));
  assert.equal(count(), 8);
  app.event(updated(at(WED, '18:50'), 'it-test-e', 2, { area_ids: [MN] }));
  assert.deepEqual(brief(newest(app)), ['item.updated', 'it-test-e', 2, 'released', 'immediate', at(WED, '18:50'), 'earlier_notification', ''], 'a paused rule matches nothing, and the reason says why the account is told');
  // The same after the rule is removed.
  app.call('follows.remove', { id: rule });
  app.event(published(at(WED, '19:00'), 'it-test-g', { area_ids: [MN] }));
  assert.equal(count(), 9);
  app.event(corrected(at(WED, '19:10'), 'it-test-e', 3, { area_ids: [MN] }));
  assert.deepEqual(brief(newest(app)), ['item.corrected', 'it-test-e', 3, 'released', 'immediate', at(WED, '19:10'), 'earlier_notification', '']);
  assert.equal(count(), 10);

  // Never two notifications for one arriving revision, and nothing already written was withdrawn or rewritten.
  const all = notifications(app);
  assert.equal(new Set(all.map(n => n.item_id + '#' + n.revision)).size, all.length);
  assert.deepEqual([all[0].matched_follow_ids, all.every(n => n.state === 'released'), app.call('follows.list', {}).follows], [[rule], true, []], 'the first notification still names the rule that has since been removed');
  // In the fixture: the clinic report was published under a paused rule and is watched; its retraction (the proposal's example) notifies through the watch alone.
  const dana = fixture();
  dana.event(proposal('ev-it-204'));
  dana.event(proposal('ev-it-210'));
  assert.deepEqual(brief(newest(dana)), ['item.retracted', CLINIC, 2, 'released', 'immediate', at(FRI, '09:15'), 'watched_clipping', '']);
  assert.deepEqual([newest(dana).title, newest(dana).body], ['Retracted: Riverside Clinic to close in December, board papers show',
    'The Halden Courier retracted its article of 16 November. Publisher\'s note: This report relied on a draft that the clinic board did not adopt. Riverside Clinic is not closing. This is revision 2. Open Belltower for the earlier version.']);
  dana.event(proposal('ev-it-207'));
  assert.deepEqual(brief(newest(dana)), ['item.updated', BRIDGE, 3, 'released', 'immediate', at(FRI, '14:00'), 'earlier_notification', ''], 'the reopening is routine, below the rule\'s minimum, and the account is told all the same');
});

test('T14 [W4] delivery: quiet hours hold an immediate notification to their end; urgent is not held; the digest release time before, at and after the digest time; the corrections preference', () => {
  let serial = 0;
  const account = (rule, preferences = {}) => { const app = fixture({ seed: bare(seed => Object.assign(seed.preferences, preferences)) }); app.call('follows.create', { area_ids: [MB], ...rule }); return app; };
  const tell = (app, when, over = {}) => { app.event(published(when, 'it-test-' + (++serial), over)); return brief(newest(app)).slice(3, 6); };
  const revise = (app, event) => { app.event(event); return brief(newest(app)).slice(3, 6); };

  // An immediate rule and quiet hours from 22:00 to 07:00.
  let app = account({ delivery: 'immediate' });
  assert.deepEqual(tell(app, at(WED, '21:59:59')), ['released', 'immediate', at(WED, '21:59:59')]);
  assert.deepEqual(tell(app, at(WED, '22:00')), ['held', 'immediate', at(THU, '07:00')], 'the start of the quiet period is inside it');
  assert.deepEqual(tell(app, at(WED, '23:10')), ['held', 'immediate', at(THU, '07:00')], 'the acceptance example');
  assert.deepEqual(tell(app, at(WED, '23:10'), { priority: 'urgent' }), ['released', 'immediate', at(WED, '23:10')], 'an urgent revision is never held by quiet hours');
  assert.deepEqual(tell(app, at(THU, '02:00')), ['held', 'immediate', at(THU, '07:00')], 'after midnight the period ends the same morning');
  assert.deepEqual(tell(app, at(THU, '06:59:59')), ['held', 'immediate', at(THU, '07:00')]);
  // The clock reaches 07:00 with no event: the four held notifications read released, and nothing was rewritten.
  const data = JSON.stringify(app.data);
  assert.deepEqual(notifications(app).map(n => n.state), ['released', 'held', 'held', 'released', 'held', 'held']);
  app.advance(at(THU, '07:00'));
  assert.deepEqual([notifications(app).map(n => n.state), JSON.stringify(app.data) === data], [Array(6).fill('released'), true]);
  assert.deepEqual(tell(app, at(THU, '07:00')), ['released', 'immediate', at(THU, '07:00')], 'the end of the quiet period is outside it');
  // Quiet hours off; a quiet period inside one day; quiet hours as wall time of the account's zone.
  app = account({ delivery: 'immediate' }, { quiet_hours: { enabled: false, start: '22:00', end: '07:00' } });
  assert.deepEqual(tell(app, at(WED, '23:10')), ['released', 'immediate', at(WED, '23:10')]);
  app = account({ delivery: 'immediate' }, { quiet_hours: { enabled: true, start: '13:00', end: '15:00' } });
  assert.deepEqual([tell(app, at(WED, '12:59')), tell(app, at(WED, '13:00')), tell(app, at(WED, '14:59')), tell(app, at(WED, '15:00')), tell(app, at(WED, '23:10'))],
    [['released', 'immediate', at(WED, '12:59')], ['held', 'immediate', at(WED, '15:00')], ['held', 'immediate', at(WED, '15:00')], ['released', 'immediate', at(WED, '15:00')], ['released', 'immediate', at(WED, '23:10')]]);
  app = account({ delivery: 'immediate' }, { timezone: 'America/New_York' });
  assert.deepEqual([tell(app, at(WED, '20:59')), tell(app, at(WED, '21:30'))], [['released', 'immediate', at(WED, '20:59')], ['held', 'immediate', '2026-11-19T07:00:00-05:00']], '21:30 in Chicago is 22:30 in New York');

  // A digest rule: before, at and after the digest time. Urgent does not turn a digest into an immediate delivery.
  app = account({ delivery: 'digest' });
  assert.deepEqual(tell(app, at(WED, '10:00')), ['held', 'digest', at(WED, '18:00')]);
  assert.deepEqual(tell(app, at(WED, '17:59:59')), ['held', 'digest', at(WED, '18:00')]);
  assert.deepEqual(tell(app, at(WED, '18:00')), ['released', 'digest', at(WED, '18:00')], 'written at the digest time, it is in that digest');
  assert.deepEqual(tell(app, at(WED, '18:00:01')), ['held', 'digest', at(THU, '18:00')]);
  assert.deepEqual(tell(app, at(WED, '18:30'), { priority: 'urgent' }), ['held', 'digest', at(THU, '18:00')], 'the person chose the digest for this rule');
  assert.deepEqual(tell(app, at(WED, '23:30')), ['held', 'digest', at(THU, '18:00')], 'quiet hours do not move a digest');
  app = account({ delivery: 'digest' }, { digest_time: '07:30', timezone: 'America/New_York' });
  assert.deepEqual(tell(app, at(WED, '06:29')), ['held', 'digest', '2026-11-18T07:30:00-05:00']);
  assert.deepEqual(tell(app, at(WED, '06:31')), ['held', 'digest', '2026-11-19T07:30:00-05:00']);

  // corrections: as_item. A correction is delivered like the item's other notifications.
  app = account({ delivery: 'digest' });
  tell(app, at(WED, '10:00'));
  assert.deepEqual(revise(app, corrected(at(WED, '11:00'), 'it-test-' + serial, 2)), ['held', 'digest', at(WED, '18:00')]);
  assert.deepEqual(revise(app, retracted(at(WED, '12:00'), 'it-test-' + serial, 3)), ['held', 'digest', at(WED, '18:00')]);
  // corrections: immediate. A correction or a retraction is delivered at once; an update is not a correction.
  app = account({ delivery: 'digest' }, { corrections: 'immediate' });
  tell(app, at(WED, '10:00'));
  assert.deepEqual(revise(app, updated(at(WED, '10:30'), 'it-test-' + serial, 2)), ['held', 'digest', at(WED, '18:00')]);
  assert.deepEqual(revise(app, corrected(at(WED, '11:00'), 'it-test-' + serial, 3)), ['released', 'immediate', at(WED, '11:00')]);
  assert.deepEqual(revise(app, updated(at(WED, '11:30'), 'it-test-' + serial, 4)), ['released', 'immediate', at(WED, '11:30')], 'once an item\'s notification was immediate, the next one is too');
  // Quiet hours apply to that immediate delivery as to any other, unless the revision is urgent.
  tell(app, at(WED, '12:00'));
  assert.deepEqual(revise(app, retracted(at(WED, '23:30'), 'it-test-' + serial, 2)), ['held', 'immediate', at(THU, '07:00')]);
  tell(app, at(WED, '23:35'), { priority: 'urgent' });
  assert.deepEqual(revise(app, corrected(at(WED, '23:40'), 'it-test-' + serial, 2, { priority: 'urgent' })), ['released', 'immediate', at(WED, '23:40')]);
  // A retraction takes its priority from the revision before it.
  assert.deepEqual(revise(app, retracted(at(WED, '23:50'), 'it-test-' + serial, 3)), ['released', 'immediate', at(WED, '23:50')]);
});

test('T15 [W4] superseding: a held notification is superseded by a revision that arrives before its release time and not by one that arrives after it; the new one names it and takes the stronger delivery', () => {
  const account = rule => { const app = fixture({ seed: bare() }); app.call('follows.create', { area_ids: [MB], ...rule }); return app; };
  const log = app => notifications(app).map(n => [n.id, n.revision, n.state, n.delivery, n.release_at, n.supersedes, n.superseded_by]);
  // The acceptance example: under a digest rule the first notification is held until 18:00 and the
  // correction at 16:30 supersedes it, so only the corrected version is released at 18:00.
  let app = account({ delivery: 'digest' });
  app.event(published(at(WED, '10:00'), 'it-test-a'));
  assert.deepEqual(log(app), [['ntf-0001', 1, 'held', 'digest', at(WED, '18:00'), null, null]]);
  const start = app.data.activity.length;
  app.event(corrected(at(WED, '16:30'), 'it-test-a', 2));
  assert.deepEqual(log(app), [['ntf-0001', 1, 'superseded', 'digest', at(WED, '18:00'), null, 'ntf-0002'], ['ntf-0002', 2, 'held', 'digest', at(WED, '18:00'), 'ntf-0001', null]]);
  assert.deepEqual(app.data.activity.slice(start).map(a => [a.action, a.object_id, a.details.by ?? null]), [['item.corrected', 'it-test-a', null], ['notification.superseded', 'ntf-0001', 'ntf-0002'], ['notification.created', 'ntf-0002', null]]);
  assert.deepEqual([app.data.activity[start + 1].details, app.data.notifications[0].superseded_at], [{ item_id: 'it-test-a', revision: 1, by: 'ntf-0002' }, at(WED, '16:30')]);
  const stored = JSON.stringify(app.data);
  app.advance(at(WED, '18:00'));
  assert.deepEqual(log(app).map(n => n[2]), ['superseded', 'released'], 'the replaced version is never released');
  assert.deepEqual([notifications(app, { state: 'released' }).map(n => n.id), notifications(app, { state: 'superseded' }).map(n => n.id), notifications(app, { state: 'held' }), JSON.stringify(app.data) === stored], [['ntf-0002'], ['ntf-0001'], [], true]);
  assert.deepEqual([sender.plan(app.snapshot()).dispatch.map(n => n.id), sender.plan(app.snapshot()).skipped], [['ntf-0002'], [{ notification_id: 'ntf-0001', reason: 'superseded', by: 'ntf-0002' }]]);
  // A revision that arrives after the release time supersedes nothing: the earlier notification was released and is followed by the new one.
  app.event(updated(at(WED, '18:05'), 'it-test-a', 3));
  assert.deepEqual(log(app).slice(1), [['ntf-0002', 2, 'released', 'digest', at(WED, '18:00'), 'ntf-0001', null], ['ntf-0003', 3, 'held', 'digest', at(THU, '18:00'), null, null]]);

  // The boundary: at the release time itself the notification was released; one second earlier it is superseded.
  app = account({ delivery: 'digest' });
  app.event(published(at(WED, '10:00'), 'it-test-b'));
  app.event(updated(at(WED, '18:00'), 'it-test-b', 2));
  assert.deepEqual(log(app), [['ntf-0001', 1, 'released', 'digest', at(WED, '18:00'), null, null], ['ntf-0002', 2, 'released', 'digest', at(WED, '18:00'), null, null]]);
  app = account({ delivery: 'digest' });
  app.event(published(at(WED, '10:00'), 'it-test-c'));
  app.event(updated(at(WED, '17:59:59'), 'it-test-c', 2));
  assert.deepEqual(log(app), [['ntf-0001', 1, 'superseded', 'digest', at(WED, '18:00'), null, 'ntf-0002'], ['ntf-0002', 2, 'held', 'digest', at(WED, '18:00'), 'ntf-0001', null]]);
  // A chain: each held notification is superseded by the next, and only the last one is released.
  app.event(corrected(at(WED, '17:59:59'), 'it-test-c', 3));
  app.event(retracted(at(WED, '17:59:59'), 'it-test-c', 4));
  assert.deepEqual(log(app).map(n => [n[0], n[2], n[5], n[6]]), [['ntf-0001', 'superseded', null, 'ntf-0002'], ['ntf-0002', 'superseded', 'ntf-0001', 'ntf-0003'], ['ntf-0003', 'superseded', 'ntf-0002', 'ntf-0004'], ['ntf-0004', 'held', 'ntf-0003', null]]);
  app.advance(at(WED, '18:00'));
  assert.deepEqual([log(app).map(n => n[2]), sender.plan(app.snapshot()).dispatch.map(n => n.id)], [['superseded', 'superseded', 'superseded', 'released'], ['ntf-0004']]);

  // The stronger of the two deliveries: a held digest notification, then the account starts to watch the item.
  app = account({ delivery: 'digest' });
  app.event(published(at(WED, '10:00'), 'it-test-d'));
  app.call('clippings.add', { id: 'it-test-d', watch: true });
  app.event(updated(at(WED, '11:00'), 'it-test-d', 2));
  assert.deepEqual(log(app), [['ntf-0001', 1, 'superseded', 'digest', at(WED, '18:00'), null, 'ntf-0002'], ['ntf-0002', 2, 'released', 'immediate', at(WED, '11:00'), 'ntf-0001', null]]);
  assert.deepEqual(newest(app).reasons, ['follow', 'earlier_notification', 'watched_clipping']);
  // An immediate delivery stays immediate when only a digest rule matches the next revision.
  app.call('clippings.remove', { id: 'clp-0001' });
  app.event(updated(at(WED, '12:00'), 'it-test-d', 3));
  assert.deepEqual(log(app).at(-1), ['ntf-0003', 3, 'released', 'immediate', at(WED, '12:00'), null, null]);

  // A notification held by quiet hours is superseded by a revision that arrives in the night.
  app = account({ delivery: 'immediate' });
  app.event(published(at(WED, '23:10'), 'it-test-e'));
  app.event(corrected(at(WED, '23:40'), 'it-test-e', 2));
  assert.deepEqual(log(app), [['ntf-0001', 1, 'superseded', 'immediate', at(THU, '07:00'), null, 'ntf-0002'], ['ntf-0002', 2, 'held', 'immediate', at(THU, '07:00'), 'ntf-0001', null]]);
  // An urgent revision in the night is released at once and supersedes what was held.
  app.event(corrected(at(WED, '23:50'), 'it-test-e', 3, { priority: 'urgent' }));
  assert.deepEqual(log(app).slice(1), [['ntf-0002', 2, 'superseded', 'immediate', at(THU, '07:00'), 'ntf-0001', 'ntf-0003'], ['ntf-0003', 3, 'released', 'immediate', at(WED, '23:50'), 'ntf-0002', null]]);
  app.advance(at(THU, '07:00'));
  assert.deepEqual(log(app).map(n => n[2]), ['superseded', 'superseded', 'released'], 'nothing is deleted: the log keeps every notification with its times and its state');
  // The fixture holds the same case: Monday's library notification was superseded by Tuesday's correction, which is held until 18:00.
  assert.deepEqual(log(fixture()).slice(9, 11), [['ntf-0010', 1, 'superseded', 'digest', at(TUE, '18:00'), null, 'ntf-0011'], ['ntf-0011', 2, 'held', 'digest', at(TUE, '18:00'), 'ntf-0010', null]]);
});

// A router that records what it is asked to publish and commits it, as Messaging does for an allowed delivery.
function mailbox() {
  const published = [];
  return { published, call: async (name, args) => { assert.equal(name, 'router.publish'); published.push(structuredClone(args)); return { status: 'committed', event_id: 'evt-' + published.length, target: { app_id: 'mail', account_id: 'mail-dana' }, committed_at: '2026-11-17T00:00:00Z' }; } };
}
// The sender reads Belltower through env.snapshot and nothing else.
const run = (app, router, sent = {}) => sender.publishReleased({ source: { call: async (name, args) => { assert.deepEqual([name, args], ['env.snapshot', undefined]); return { status: 'ok', snapshot: app.snapshot() }; } }, router, sent });

test('T16 [all] the platform clock: after time moves with no App event a held notification reads released and the sender publishes it, a superseded one never; a replaced one is skipped; a notice changes its effect', async () => {
  const app = fixture(), router = mailbox(), sent = {};
  // At the fixture's clock eleven notifications are history and one is held until 18:00.
  let report = await run(app, router, sent);
  assert.deepEqual([report.stage, report.dispatched, report.skipped, report.left_out], ['nothing_pending', [], [{ notification_id: 'ntf-0011', reason: 'held', release_at: at(TUE, '18:00') }], { history: 11, no_email: 0, already_sent: 0 }]);
  // Infra moves the clock to 18:00. No App code runs and business data stays as it is.
  const data = JSON.stringify(app.data);
  app.advance(at(TUE, '18:00'));
  assert.deepEqual(notifications(app).slice(9, 11).map(n => [n.id, n.state]), [['ntf-0010', 'superseded'], ['ntf-0011', 'released']]);
  report = await run(app, router, sent);
  assert.deepEqual([report.stage, report.virtual_now, report.skipped, report.dispatched.map(d => [d.notification_id, d.item_id, d.revision, d.request_id, d.result.status])],
    ['delivered', at(TUE, '18:00'), [], [['ntf-0011', LIBRARY, 2, 'belltower:1:ntf-0011', 'committed']]]);
  assert.deepEqual(router.published, [{ request_id: 'belltower:1:ntf-0011', message: app.data.notifications[10].wire }], 'the corrected version, and never the superseded one');
  assert.deepEqual([router.published[0].message.time, router.published[0].message.data.content.title], [at(TUE, '18:00'), 'Correction: Old Quay Library open until 19:00 on weekdays']);
  assert.equal(JSON.stringify(app.data), data, 'neither the clock nor the sender wrote into Belltower');
  // A second run publishes nothing twice.
  report = await run(app, router, sent);
  assert.deepEqual([report.stage, report.dispatched, report.left_out, router.published.length, Object.keys(sent)], ['nothing_pending', [], { history: 11, no_email: 0, already_sent: 1 }, 1, ['ntf-0011']]);
  // A public notice comes into effect and ends with the clock alone.
  assert.equal(item(app, BRIDGE).effect, 'upcoming');
  app.advance(at(WED, '07:00'));
  assert.equal(item(app, BRIDGE).effect, 'in_effect');
  app.advance(at(SAT, '18:00'));
  assert.deepEqual([item(app, BRIDGE).effect, JSON.stringify(app.data) === data, app.data.activity.length], ['ended', true, 110], 'a time-driven change writes no activity row');

  // Delayed dispatch, as in the plan: a notification is due at 18:00, its item is corrected at 18:05
  // and the sender first runs at 18:10. Mail gets no copy of the old version.
  const again = { topics: ['libraries'], area_ids: [OQ], priority: 'routine' };
  const late = fixture(), lateMail = mailbox(), lateLog = {};
  late.advance(at(TUE, '18:00'));
  late.event(corrected(at(TUE, '18:05'), LIBRARY, 3, again));
  late.advance(at(TUE, '18:10'));
  report = await run(late, lateMail, lateLog);
  assert.deepEqual([report.stage, report.dispatched, report.skipped], ['nothing_pending', [], [{ notification_id: 'ntf-0011', reason: 'replaced', revision: 2, latest_revision: 3 }, { notification_id: 'ntf-0013', reason: 'held', release_at: at(WED, '18:00') }]]);
  assert.deepEqual(notifications(late, { id: LIBRARY }).map(n => [n.id, n.revision, n.state, n.release_at]), [['ntf-0010', 1, 'superseded', at(TUE, '18:00')], ['ntf-0011', 2, 'released', at(TUE, '18:00')], ['ntf-0013', 3, 'held', at(WED, '18:00')]],
    'in the log the 18:00 notification is released; it was not superseded, because its release time had been reached');
  // The account keeps corrections in the digest, so the correction is dispatched after the next digest time: one record in Mail.
  late.advance(at(WED, '18:00'));
  report = await run(late, lateMail, lateLog);
  assert.deepEqual([report.dispatched.map(d => d.notification_id), report.skipped.map(s => [s.notification_id, s.reason]), lateMail.published.map(p => p.message.id)], [['ntf-0013'], [['ntf-0011', 'replaced']], ['ntf-0013']]);
  // When corrections are delivered at once, the first run at 18:10 dispatches the correction in that same run.
  const atOnce = fixture(), onceMail = mailbox();
  atOnce.call('preferences.update', { patch: { corrections: 'immediate' } });
  atOnce.advance(at(TUE, '18:00'));
  atOnce.event(corrected(at(TUE, '18:05'), LIBRARY, 3, again));
  atOnce.advance(at(TUE, '18:10'));
  report = await run(atOnce, onceMail);
  assert.deepEqual([report.stage, report.dispatched.map(d => d.notification_id), report.skipped, onceMail.published.map(p => [p.message.id, p.message.time])], ['delivered', ['ntf-0013'], [{ notification_id: 'ntf-0011', reason: 'replaced', revision: 2, latest_revision: 3 }], [['ntf-0013', at(TUE, '18:05')]]]);
  // Had the sender also run at 18:02, Mail would hold two records in order: the notification and then its correction.
  const twice = fixture(), twiceMail = mailbox(), twiceLog = {};
  twice.call('preferences.update', { patch: { corrections: 'immediate' } });
  twice.advance(at(TUE, '18:02'));
  await run(twice, twiceMail, twiceLog);
  twice.event(corrected(at(TUE, '18:05'), LIBRARY, 3, again));
  twice.advance(at(TUE, '18:10'));
  report = await run(twice, twiceMail, twiceLog);
  assert.deepEqual([twiceMail.published.map(p => p.message.id), report.skipped, report.left_out.already_sent], [['ntf-0011', 'ntf-0013'], [], 1]);
  // In every case the log keeps both notifications with their release times.
  for (const each of [late, atOnce, twice]) assert.deepEqual(notifications(each, { id: LIBRARY }).slice(1).map(n => [n.id, n.state === 'superseded']), [['ntf-0011', false], ['ntf-0013', false]]);

  // Released notifications are published in order of release time. A delivery that Messaging does not
  // commit stops the run; nothing after it is passed over and nothing is recorded as sent.
  const two = fixture(), log = {};
  two.event(proposal('ev-it-204'));
  two.advance(at(WED, '18:00'));
  const refusing = { calls: 0, call: async () => { refusing.calls++; return { status: 'rejected', reason: 'recipient_unavailable' }; } };
  report = await run(two, refusing, log);
  assert.deepEqual([report.stage, report.dispatched.map(d => [d.notification_id, d.result.status]), refusing.calls, log], ['router_rejected', [['ntf-0011', 'rejected']], 1, {}]);
  const good = mailbox();
  report = await run(two, good, log);
  assert.deepEqual([report.stage, good.published.map(p => [p.message.id, p.message.time]), Object.keys(log)], ['delivered', [['ntf-0011', at(TUE, '18:00')], ['ntf-0013', at(WED, '07:00')]], ['ntf-0011', 'ntf-0013']]);
  const unreadable = await sender.publishReleased({ source: { call: async () => ({ status: 'permission_denied' }) }, router: good });
  assert.deepEqual([unreadable.stage, unreadable.dispatched, good.published.length], ['source_read', [], 2]);

  // The wire message is stored only when email notices are on at the moment the notification is written.
  const off = fixture({ seed: seedWith(seed => { seed.preferences.email_notices = false; }) });
  off.event(proposal('ev-it-204'));
  off.advance(at(WED, '07:00'));
  assert.deepEqual([newest(off).state, newest(off).email_prepared, 'wire' in off.data.notifications.at(-1)], ['released', false, false]);
  assert.deepEqual([sender.plan(off.snapshot()).dispatch.map(n => n.id), sender.plan(off.snapshot()).left_out], [['ntf-0011'], { history: 11, no_email: 1, already_sent: 0 }], 'the log is written all the same; there is nothing to send for it');
});

const RUNTIME = process.env.PALE_RUNTIME_ROOT;
test('T17 [all] Core contracts, the real env.advance_time and reset on the public runtime (real MCP)', t => {
  if (!RUNTIME) return t.skip('set PALE_RUNTIME_ROOT to the runtime directory of a public checkout, or run tests/mcp.integration.cjs --runtime DIR');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'mcp.integration.cjs'), '--runtime', RUNTIME], { encoding: 'utf8', timeout: 180000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('T16b [all] Belltower -> Mail through Messaging on the public runtime (real MCP)', t => {
  if (!RUNTIME) return t.skip('set PALE_RUNTIME_ROOT to the runtime directory of a public checkout that holds this package and the Mail package, or run tests/mail.integration.cjs --runtime DIR');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'mail.integration.cjs'), '--runtime', RUNTIME], { encoding: 'utf8', timeout: 180000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('T18 [all] seed validation failures; one activity row for each committed write, each applied event and each effect of an event, none for a rejected call or a time-driven change', () => {
  const ITEM = id => seed => seed.items.find(i => i.id === id), NOTE = id => seed => seed.notifications.find(n => n.id === id), CLIP = id => seed => seed.clippings.find(c => c.id === id);
  const bridge = ITEM(BRIDGE), boil = ITEM(BOIL), copyOf = seed => structuredClone(bridge(seed));
  const invalid = [
    // The account and its owner come from the binding.
    seed => { seed.account_id = 'belltower-nobody'; }, seed => { seed.owner_person_id = 'person-nobody'; }, seed => { seed.account_id = 'mail-dana'; },
    // IDs are unique across every kind of record.
    seed => { seed.items.push(copyOf(seed)); }, seed => { bridge(seed).id = 'src-works'; }, seed => { seed.follows[1].id = 'fl-0001'; }, seed => { CLIP('clp-0002')(seed).id = 'ntf-0001'; },
    seed => { seed.areas.push({ ...seed.areas[1] }); }, seed => { seed.sources[5].id = 'ar-halden'; },
    // The area tree.
    seed => { seed.areas[1].parent_id = 'ar-nowhere'; }, seed => { seed.areas[0].parent_id = MB; }, seed => { seed.areas[1].parent_id = null; }, seed => { seed.areas[1].parent_id = FH; },
    seed => { seed.areas[2].parent_id = H; }, seed => { seed.areas[2].level = 'district'; }, seed => { seed.areas[1].parent_id = FH; seed.areas[4].parent_id = MB; },
    // Items and the order of their revisions.
    seed => { bridge(seed).source_id = 'src-nowhere'; }, seed => { bridge(seed).revisions[0].number = 2; }, seed => { bridge(seed).revisions[1].number = 3; }, seed => { bridge(seed).revisions[1].number = 1; },
    seed => { bridge(seed).revisions[0].type = 'update'; }, seed => { bridge(seed).revisions[1].type = 'original'; delete bridge(seed).revisions[1].note; },
    seed => { const i = ITEM('it-cour-0893')(seed); i.revisions.push({ ...i.revisions[0], number: 3, type: 'update' }); },
    seed => { bridge(seed).revisions[0].published_at = at('2026-11-16', '10:00:01'); }, seed => { bridge(seed).revisions[1].published_at = at('2026-11-16', '09:44'); }, seed => { bridge(seed).revisions[1].received_at = at('2026-11-16', '09:59'); bridge(seed).revisions[1].published_at = at('2026-11-16', '09:50'); },
    // What each type of revision carries.
    seed => { delete ITEM('it-cour-0893')(seed).revisions[1].note; }, seed => { ITEM('it-cour-0893')(seed).revisions[1].headline = 'A retraction has no text'; }, seed => { ITEM('it-cour-0893')(seed).revisions[1].topics = ['government']; },
    seed => { ITEM('it-bull-0304')(seed).revisions[1].based_on = { item_id: 'it-ledg-0415', revision: 2, relation: 'copy' }; },
    seed => { delete bridge(seed).revisions[0].body; }, seed => { delete bridge(seed).revisions[1].priority; }, seed => { delete bridge(seed).revisions[1].note; }, seed => { bridge(seed).revisions[0].note = 'An original has no note.'; },
    seed => { boil(seed).revisions[2].note = 'An update has no note.'; }, seed => { bridge(seed).revisions[1].area_ids = [MB, 'ar-nowhere']; },
    // Effective periods and bases.
    seed => { ITEM(CLINIC)(seed).revisions[0].effective = { start: at(TUE, '09:00'), end: null }; }, seed => { bridge(seed).revisions[1].effective.end = at(WED, '07:00'); }, seed => { bridge(seed).revisions[1].effective.end = at(WED, '06:00'); },
    seed => { ITEM('it-round-5517')(seed).revisions[0].based_on.item_id = 'it-nowhere-1'; }, seed => { ITEM('it-round-5517')(seed).revisions[0].based_on.revision = 3; }, seed => { ITEM('it-round-5517')(seed).revisions[0].based_on.item_id = 'it-round-5517'; },
    seed => { ITEM('it-round-5517')(seed).revisions[0].based_on.revision = 2; },
    // Preferences.
    seed => { seed.preferences.timezone = 'Mars/Olympus_Mons'; }, seed => { seed.preferences.quiet_hours.end = '22:00'; }, seed => { seed.preferences.digest_time = '23:00'; }, seed => { seed.preferences.quiet_hours.start = '17:00'; },
    // Follow rules.
    seed => { seed.follows[1].source_ids = ['src-nowhere']; }, seed => { seed.follows[0].area_ids = ['ar-nowhere']; }, seed => { seed.follows[4].source_ids = []; seed.follows[4].topics = []; },
    seed => { seed.follows[4] = { ...seed.follows[3], id: 'fl-0005', delivery: 'immediate' }; }, seed => { seed.follows[4].updated_at = at('2026-11-14', '09:59'); },
    // Read marks.
    seed => { seed.read_marks[0].item_id = 'it-nowhere-1'; }, seed => { seed.read_marks[0].revision = 3; }, seed => { seed.read_marks.push({ ...seed.read_marks[5] }); }, seed => { seed.read_marks.find(m => m.item_id === BRIDGE).read_at = at('2026-11-16', '09:59'); },
    // Clippings.
    seed => { CLIP('clp-0002')(seed).item_id = 'it-nowhere-1'; }, seed => { CLIP('clp-0002')(seed).item_id = BOIL; }, seed => { CLIP('clp-0004')(seed).revision = 3; }, seed => { CLIP('clp-0001')(seed).history[1].revision = 4; },
    seed => { CLIP('clp-0001')(seed).revision = 1; }, seed => { CLIP('clp-0001')(seed).history[0].revision = 3; }, seed => { CLIP('clp-0004')(seed).created_at = at('2026-11-16', '19:09'); },
    seed => { CLIP('clp-0001')(seed).history[0].replaced_at = at('2026-11-11', '14:39'); }, seed => { CLIP('clp-0001')(seed).history[1].replaced_at = at('2026-11-11', '14:59'); }, seed => { CLIP('clp-0001')(seed).history[0].replaced_at = at('2026-11-10', '09:39'); },
    // The notification log.
    seed => { NOTE('ntf-0009')(seed).item_id = 'it-nowhere-1'; }, seed => { NOTE('ntf-0009')(seed).revision = 3; }, seed => { NOTE('ntf-0012')(seed).kind = 'item.updated'; }, seed => { NOTE('ntf-0009')(seed).created_at = at('2026-11-16', '10:00:01'); NOTE('ntf-0009')(seed).release_at = at('2026-11-16', '10:00:01'); },
    seed => { NOTE('ntf-0003')(seed).release_at = at('2026-11-11', '23:09'); }, seed => { seed.notifications.reverse(); }, seed => { NOTE('ntf-0001')(seed).matched_follow_ids = []; }, seed => { NOTE('ntf-0005')(seed).matched_follow_ids = ['fl-0003']; },
    seed => { NOTE('ntf-0005')(seed).reasons = ['follow']; NOTE('ntf-0005')(seed).matched_follow_ids = ['fl-0003']; }, seed => { NOTE('ntf-0001')(seed).reasons = ['follow', 'earlier_notification']; },
    seed => { seed.notifications = seed.notifications.filter(n => n.id !== 'ntf-0002'); }, seed => { NOTE('ntf-0012')(seed).revision = 1; NOTE('ntf-0012')(seed).kind = 'item.published'; NOTE('ntf-0012')(seed).created_at = NOTE('ntf-0012')(seed).release_at = at('2026-11-16', '10:00'); },
    seed => { NOTE('ntf-0012')(seed).delivery = 'digest'; NOTE('ntf-0012')(seed).release_at = at(TUE, '18:00'); }, seed => { delete NOTE('ntf-0010')(seed).superseded_by; }, seed => { delete NOTE('ntf-0011')(seed).supersedes; }, seed => { delete NOTE('ntf-0010')(seed).superseded_at; },
    seed => { NOTE('ntf-0010')(seed).superseded_at = at(TUE, '11:19'); }, seed => { NOTE('ntf-0010')(seed).superseded_by = 'ntf-0012'; }, seed => { NOTE('ntf-0009')(seed).superseded_by = 'ntf-0012'; NOTE('ntf-0009')(seed).superseded_at = at(TUE, '16:30'); NOTE('ntf-0012')(seed).supersedes = 'ntf-0009'; },
    seed => { NOTE('ntf-0001')(seed).supersedes = 'ntf-0002'; }, seed => { NOTE('ntf-0011')(seed).superseded_by = 'ntf-0012'; NOTE('ntf-0011')(seed).superseded_at = at(TUE, '16:30'); },
    seed => { NOTE('ntf-0011')(seed).release_at = at(TUE, '11:20'); NOTE('ntf-0010')(seed).release_at = at(TUE, '11:20'); },
    // The activity log.
    seed => { seed.activity[5].seq = 5; }, seed => { seed.activity[0].seq = 111; },
  ];
  const messages = new Set();
  invalid.forEach((change, i) => assert.throws(() => fixture({ seed: seedWith(change) }), e => { messages.add(e.message); return e.code === 'invalid_seed'; }, 'invalid seed #' + (i + 1)));
  assert.deepEqual([invalid.length, messages.size >= 55], [90, true], 'each rule answers with its own message');
  // The offset rule is also the App's own: the schema asks for it first, so it is called directly here.
  const ctx = { app_id: 'belltower', virtual_now: CLOCK, binding: require('../fixtures/binding.json') };
  for (const change of [seed => { bridge(seed).revisions[0].published_at = '2026-11-16T09:45:00'; }, seed => { seed.read_marks[0].read_at = '2026-10-28 20:10'; }, seed => { NOTE('ntf-0001')(seed).release_at = 'soon'; }, seed => { bridge(seed).revisions[1].effective.end = '2026-11-21'; }, seed => { seed.activity[0].at = 1; }]) {
    assert.throws(() => plugin.validateSeed(ctx, seedWith(change)), { code: 'invalid_seed', message: /a timestamp needs its UTC offset/ });
  }
  plugin.validateSeed(ctx, seedCopy());
  // Shapes the seed schema refuses.
  const shapes = [
    seed => { bridge(seed).revisions[0].topics = ['sport']; }, seed => { bridge(seed).revisions[0].topics = []; }, seed => { bridge(seed).revisions[0].priority = 'high'; }, seed => { bridge(seed).revisions[0].published_at = '2026-11-16T09:45:00'; },
    seed => { bridge(seed).kind = 'post'; }, seed => { bridge(seed).revisions = []; }, seed => { bridge(seed).id = 'has space'; }, seed => { delete seed.preferences.digest_time; }, seed => { seed.preferences.corrections = 'never'; },
    seed => { seed.extra = true; }, seed => { delete seed.read_marks; }, seed => { seed.follows[0].delivery = 'weekly'; }, seed => { NOTE('ntf-0001')(seed).reasons = []; }, seed => { NOTE('ntf-0001')(seed).reasons = ['luck']; },
    seed => { CLIP('clp-0003')(seed).linked_object = { app_id: 'tasks' }; }, seed => { seed.sources[0].kind = 'blog'; }, seed => { seed.areas[0].level = 'region'; },
    seed => { for (let i = 6; i <= 21; i++) seed.follows.push({ ...seed.follows[0], id: 'fl-00' + String(i).padStart(2, '0'), topics: ['roads'], area_ids: [seed.areas[i % 9].id], min_priority: i > 14 ? 'urgent' : 'important' }); },
    seed => { bridge(seed).revisions[1].based_on = { item_id: BOIL, revision: 1, relation: 'quote' }; },
  ];
  shapes.forEach((change, i) => assert.throws(() => fixture({ seed: seedWith(change) }), { code: 'schema_mismatch' }, 'schema-refused seed #' + (i + 1)));
  assert.equal(shapes.length, 19);

  // What is valid: the fixture at any clock (no rule reads the time), an account that has done nothing,
  // a world with nothing published, and notifications that name a rule that has since been removed.
  assert.equal(fixture({ now: '2026-01-01T00:00:00Z' }).call('items.list', {}).items.length, 20);
  assert.equal(fixture({ now: '2031-01-01T00:00:00Z' }).call('notifications.list', { state: 'held' }).notifications.length, 0);
  const empty = fixture({ seed: bare(seed => { seed.items = []; seed.sources = seed.sources.slice(0, 1); seed.areas = seed.areas.slice(0, 1); }) });
  for (const [name, args, key] of [['sources.list', {}, 'sources'], ['areas.list', {}, 'areas'], ['items.list', {}, 'items'], ['follows.list', {}, 'follows'], ['reading.list', {}, 'marks'], ['clippings.list', {}, 'clippings'], ['notifications.list', {}, 'notifications']]) {
    assert.equal(empty.call(name, args)[key].length, name === 'sources.list' || name === 'areas.list' ? 1 : 0, name);
  }
  assert.equal(empty.call('preferences.get', {}).preferences.digest_time, '18:00');
  rejects(empty, () => empty.call('items.get', { id: BRIDGE }), 'not_found');
  assert.equal(fixture({ seed: seedWith(seed => { seed.follows = seed.follows.filter(f => f.id !== 'fl-0002'); }) }).call('notifications.list', {}).notifications.length, 12);

  // Generated IDs never collide with an ID in use or with one the logs still name.
  const crowded = fixture({ seed: seedWith(seed => { bridge(seed).id = 'ntf-0013'; seed.read_marks.find(m => m.item_id === BRIDGE).item_id = 'ntf-0013'; for (const n of seed.notifications) if (n.item_id === BRIDGE) { n.item_id = 'ntf-0013'; n.wire.data.source_object.object_id = 'ntf-0013'; }
    seed.activity.push({ seq: 111, at: CLOCK, actor: 'agent', action: 'follows.remove', object_id: 'fl-0009' }, { seq: 112, at: CLOCK, actor: 'agent', action: 'clippings.remove', object_id: 'clp-0007' }); }) });
  crowded.event(updated(at(TUE, '17:30'), 'ntf-0013', 3));
  assert.deepEqual([newest(crowded).id, crowded.call('follows.create', { topics: ['weather'], delivery: 'digest' }).id, crowded.call('clippings.add', { id: MAIN }).id], ['ntf-0014', 'fl-0010', 'clp-0008']);

  // The activity log. One row for every committed write, every applied event and every effect of an event.
  const app = fixture(), before = app.data.activity.length;
  const agentRows = app.data.activity.filter(a => a.actor === 'agent'), eventRows = app.data.activity.filter(a => a.actor === 'event');
  assert.deepEqual([before, agentRows.length, eventRows.filter(a => a.action.startsWith('item.')).length, eventRows.filter(a => a.action === 'notification.created').length, eventRows.filter(a => a.action === 'notification.superseded').length], [110, 27, 70, 12, 1],
    'the fixture: 27 writes, 70 events, 12 notifications written, 1 superseded');
  assert.ok(app.data.activity.every((a, i) => a.seq === i + 1 && (a.actor === 'agent' ? typeof a.request_id === 'string' && a.event_id === undefined : typeof a.event_id === 'string' && a.request_id === undefined)));
  assert.deepEqual(app.data.notifications.map(n => app.data.activity[n.seq - 1].object_id), app.data.notifications.map(n => n.id), 'a notification carries the sequence number of its row');
  app.call('reading.mark', { id: BRIDGE });                                                  // 1 write
  app.call('clippings.add', { id: BRIDGE, watch: true });                                    // 1 write
  rejects(app, () => app.call('clippings.add', { id: BRIDGE }), 'already_clipped');          // a rejected call: no row
  rejects(app, () => app.call('follows.remove', { id: 'fl-0099' }), 'not_found');
  rejects(app, () => app.event(updated(at(WED, '10:00'), BRIDGE, 9)), 'invalid_event');      // a rejected event: no row
  app.call('items.get', { id: BRIDGE }); app.call('notifications.list', {});                 // reads: no row
  app.advance(at(TUE, '18:00'));                                                             // time alone: no row, though ntf-0011 is released by it
  app.event(proposal('ev-it-204'));                                                          // 1 event + 1 notification written
  app.event(published(at(WED, '06:20'), 'it-test-1', { area_ids: [OQ], topics: ['weather'], priority: 'routine' }));   // 1 event, no effect
  app.event(corrected(at(WED, '06:30'), COPY, 2));                      // 1 event + 1 superseded + 1 written
  app.call('preferences.update', { patch: { corrections: 'immediate' } });                   // 1 write
  assert.deepEqual(actions(app, before), ['agent:reading.mark:' + BRIDGE, 'agent:clippings.add:clp-0005', 'event:item.published:' + COPY, 'event:notification.created:ntf-0013', 'event:item.published:it-test-1',
    'event:item.corrected:' + COPY, 'event:notification.superseded:ntf-0013', 'event:notification.created:ntf-0014', 'agent:preferences.update:belltower-dana']);
  assert.deepEqual(app.data.activity.slice(before).map(a => a.seq), [111, 112, 113, 114, 115, 116, 117, 118, 119]);
  assert.deepEqual(app.data.activity.slice(before).map(a => a.at), [CLOCK, CLOCK, at(WED, '06:10'), at(WED, '06:10'), at(WED, '06:20'), at(WED, '06:30'), at(WED, '06:30'), at(WED, '06:30'), at(WED, '06:30')], 'each row carries the virtual time of its write or event');
});

test('the approved plan\'s examples: the four events and the wire message, as written in the proposal', () => {
  const builder = require('../dev/build-fixture.cjs'), events = require('./proposal-events.json'), valid = require('./schema-validator.cjs').compile(require('../schemas/events.schema.json'), path.join(__dirname, '../schemas'));
  assert.deepEqual(events.map(e => [e.event_id, e.operation]), [['ev-it-204', 'belltower.item.published'], ['ev-it-207', 'belltower.item.updated'], ['ev-it-203', 'belltower.item.corrected'], ['ev-it-210', 'belltower.item.retracted']]);
  for (const event of events) assert.ok(valid(event), event.event_id + ' matches schemas/events.schema.json');
  // The correction (ev-it-203) is the last step of the fixture's history: applied to the state before it, it gives the fixture.
  const app = builder.build({ until: 'before-last' });
  assert.deepEqual([item(app, BRIDGE).latest_revision, notifications(app).length], [1, 11]);
  app.event(proposal('ev-it-203'));
  app.advance(CLOCK);
  assert.deepEqual(app.data, seedCopy());
  // Its notification is the twelfth, and its stored wire message is the proposal's example, character for character.
  const wire = require('./proposal-wire.json');
  assert.deepEqual([newest(app).id, app.data.notifications.at(-1).wire, JSON.stringify(app.data.notifications.at(-1).wire) === JSON.stringify(wire)], ['ntf-0012', wire, true]);
  // The other three apply to the fixture in time order.
  for (const id of ['ev-it-204', 'ev-it-210', 'ev-it-207']) app.event(proposal(id));
  assert.deepEqual(notifications(app).slice(12).map(brief), [
    ['item.published', COPY, 1, 'released', 'immediate', at(WED, '07:00'), 'follow', 'fl-0003'],
    ['item.retracted', CLINIC, 2, 'released', 'immediate', at(FRI, '09:15'), 'watched_clipping', ''],
    ['item.updated', BRIDGE, 3, 'released', 'immediate', at(FRI, '14:00'), 'earlier_notification', ''],
  ]);
  assert.deepEqual([item(app, BRIDGE).status, item(app, BRIDGE).effect, item(app, CLINIC).status, item(app, COPY).based_on.revision, app.call('clippings.list', { state: 'behind' }).clippings.map(c => c.id)], ['corrected', 'in_effect', 'retracted', 1, ['clp-0004', 'clp-0003']]);
});

test('contracts, fixture and declarations are in step', () => {
  const dev = path.join(__dirname, '../dev');
  for (const [ref, text] of Object.entries(require(path.join(dev, 'build.cjs')).outputs())) assert.equal(fs.readFileSync(path.join(__dirname, '..', ref), 'utf8'), text, ref + ' differs from dev/contracts.cjs');
  const builder = require(path.join(dev, 'build-fixture.cjs'));
  assert.equal(fs.readFileSync(path.join(__dirname, '../fixtures/minimal.json'), 'utf8'), builder.print(builder.build().data), 'fixtures/minimal.json differs from dev/build-fixture.cjs');
  assert.deepEqual(require(path.join(dev, 'check-fixture.cjs')).check().problems, []);
  const manifest = require('../app.json'), tools = require('../tools.json'), declared = require('../contribution/contribution.json'), policies = require('../fixtures/policies.json');
  assert.deepEqual(tools.map(t => t.name.slice(10)).sort(), require('../src/operations.cjs').tools.slice().sort());
  assert.deepEqual([tools.filter(t => t.read_only).length, tools.filter(t => !t.read_only).length], [9, 8]);
  assert.deepEqual(tools.map(t => t.name.slice(10)), ['sources.list', 'areas.list', 'items.list', 'items.get', 'follows.list', 'reading.list', 'clippings.list', 'notifications.list', 'preferences.get',
    'follows.create', 'follows.update', 'follows.remove', 'preferences.update', 'reading.mark', 'clippings.add', 'clippings.update', 'clippings.remove']);
  // Every write takes Core's request_id and expected_version; the target object is always `id` and a window is always start / end.
  for (const tool of tools) {
    const names = Object.keys(tool.inputSchema.properties);
    assert.equal(!tool.read_only, names.includes('request_id') && names.includes('expected_version') && tool.inputSchema.required.includes('request_id') && tool.inputSchema.required.includes('expected_version'), tool.name);
    assert.ok(names.every(name => !/(_id|Id)$/.test(name) || name === 'request_id' || name === 'source_id' || name === 'area_id'), tool.name + ' names its target `id`');
    assert.ok(!names.some(name => /^(from|to|since|until|before|after|begin)$/.test(name)), tool.name + ' names a time window start / end');
    assert.ok(tool.description.length >= 100 && tool.outputSchema.anyOf.length === 2);
  }
  assert.deepEqual(declared.interfaces.find(i => i.interface_id === 'agent-mcp').operations.map(o => [o.name, o.effect]), tools.map(t => [t.name, t.read_only ? 'read' : 'write']));
  assert.deepEqual(declared.events.accepts.map(e => e.type), manifest.event_types);
  assert.deepEqual(manifest.event_types.map(e => e.slice(10)), ['item.published', 'item.updated', 'item.corrected', 'item.retracted'], 'four events and no clock event');
  assert.deepEqual(require('../schemas/events.schema.json').oneOf.map(e => e.properties.operation.const), manifest.event_types);
  assert.deepEqual([declared.app_id, declared.messaging.receives, declared.dependencies.required_apps, declared.shared_data.cross_app_references, manifest.dependencies, manifest.capabilities.resources], ['belltower', [], [], false, [], false]);
  assert.deepEqual(declared.messaging.publishes.map(p => [p.channel, p.schema_id, p.event_type, p.payload_schema_id, p.status]), [['channel.email', 'urn:pale:email-message:2', 'org.pale.mail.notification.v1', 'urn:pale:email-payload:1', 'implemented']]);
  assert.deepEqual([policies.sandbox.allow.slice().sort(), policies.scenario.allow.every(name => tools.some(t => t.name === name)), Object.keys(policies.scenario.constraints).every(name => policies.scenario.allow.includes(name))], [tools.map(t => t.name).sort(), true, true]);
  // Every stored wire message passes the package's copy of Mail's wire schema (urn:pale:email-message:2).
  const wireSchema = require('../schemas/router-message.schema.json'), wireValid = require('./schema-validator.cjs').compile(wireSchema, path.join(__dirname, '../schemas'));
  assert.equal(wireSchema.$id, 'urn:pale:email-message:2');
  const example = require('./proposal-wire.json');
  for (const candidate of [example, ...seedCopy().notifications.map(n => n.wire)]) assert.ok(wireValid(candidate), 'wire message ' + candidate.id + ' matches Mail\'s schema');
  const noRecipient = structuredClone(example); delete noRecipient.data.recipient;
  const otherType = { ...structuredClone(example), type: 'org.pale.other.v1' };
  assert.deepEqual([wireValid(noRecipient), wireValid(otherType)], [false, false], 'broken variants fail');
  assert.equal(require('../fixtures/clock.json').initial_time, builder.CLOCK);
  const dataset = require('../contribution/dataset.json'), counts = require(path.join(dev, 'check-fixture.cjs')).check().counts;
  assert.equal(dataset.expected_counts.records, plugin.records(seedCopy()).length);
  assert.deepEqual([plugin.records(seedCopy()).length, plugin.objects(seedCopy()).length, new Set(plugin.objects(seedCopy())).size, plugin.references(seedCopy())], [84, 84, 84, []]);
  const p = dataset.sources[0].generation.parameters;
  assert.deepEqual([p.areas, p.sources, p.items, p.revisions, p.public_notices, p.updates, p.corrections, p.retractions, p.copies, p.reports, p.follow_rules, p.read_marks, p.clippings, p.notifications],
    [counts.areas, counts.sources, counts.items, counts.revisions, counts.notices, counts.updates, counts.corrections, counts.retractions, counts.copies, counts.reports, counts.follow_rules, counts.read_marks, counts.clippings, counts.notifications]);
  assert.ok(manifest.event_types.includes(scenario().operation));
  const cases = require('./cases.json');
  assert.equal(fixture().call(cases.read.name.slice(10), cases.read.args).item.latest_revision, 2, 'the read case of the public verifier returns the corrected bridge notice');
  // The App errors named in the plan are the ones the business code can answer, and no other.
  const codes = new Set();
  for (const file of fs.readdirSync(path.join(__dirname, '../src'))) for (const m of fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').matchAll(/(?:fail\(|code: )'([a-z_]+)'/g)) codes.add(m[1]);
  assert.deepEqual([...codes].sort(), ['already_clipped', 'already_following', 'already_read', 'invalid_arguments', 'invalid_event', 'invalid_revision', 'invalid_seed', 'invalid_timezone', 'invalid_window', 'limit_exceeded', 'not_found']);
});

test('invariants hold along a seeded random walk over every write, every event and the clock', () => {
  // dev/walk.cjs: the harness checks each argument, result and resulting state at every step; the
  // walk adds its own oracle for the notification rules, which shares no code with src/, and
  // compares the reads with the stored records and with the sender's plan every eighth step.
  // Three walks here, each under its own preferences: seed 5 in New York with quiet hours and no
  // email notices, seed 7 in Kolkata with corrections delivered at once, seed 12 in Chicago with
  // quiet hours off and a 07:30 digest. `node dev/walk.cjs` runs twenty walks of 300 steps,
  // comparing every fourth step.
  const seen = {};
  for (const seedNumber of [5, 7, 12]) for (const [name, c] of Object.entries(require('../dev/walk.cjs').walk(seedNumber, 110, 8))) { seen[name] = seen[name] || { ok: 0, refused: 0 }; seen[name].ok += c.ok; seen[name].refused += c.refused; }
  assert.deepEqual(Object.keys(seen).sort(), [...require('../tools.json').filter(t => !t.read_only).map(t => t.name.slice(10)), ...require('../app.json').event_types.map(e => e.slice(10)), 'env.advance_time'].sort(), 'every write, every event and the clock were walked');
  assert.ok(Object.values(seen).every(counts => counts.ok > 0), 'and each of them succeeded at least once');
});

test('the web pages are declared, cover every tool and render text only', () => {
  const root = path.resolve(__dirname, '..'), contribution = require('../contribution/contribution.json');
  assert.equal(contribution.gui_ref, 'gui.json');
  const gui = require('../contribution/gui.json'), web = gui.extensions.find(e => e.namespace === 'pale.web' && e.version === '1');
  assert.deepEqual([gui.audience, gui.status, web.required, web.data.status, web.data.transport], [['reviewer'], 'declared', false, 'implemented', 'agent-mcp-bridge']);
  assert.deepEqual(gui.content_policy, { untrusted_html: 'text_only', svg: 'disabled', remote_fetch: 'disabled', remote_allowlist: [], missing_asset_behavior: 'placeholder' });
  for (const ref of [web.data.page, web.data.controller, gui.renderer_ref]) assert.ok(fs.existsSync(path.join(root, ref)), ref + ' is in the package');
  const controller = fs.readFileSync(path.join(root, web.data.controller), 'utf8');
  for (const tool of require('../tools.json')) assert.ok(controller.includes("'" + tool.name + "'"), 'the controller names ' + tool.name);
  // The page is built from text nodes: no HTML strings, no code from strings, no inline styles (the Host's content policy blocks them).
  assert.doesNotMatch(controller, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setAttribute\(\s*['"]style/);
  // The only file the page loads besides itself is the Host's shared client.
  assert.deepEqual([...controller.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]), ['/shared/client.js']);
  assert.doesNotMatch(controller, /\bfetch\(|XMLHttpRequest|WebSocket|Date\.now\(|new Date\(\)/, 'the controller calls tools only through the shared client and never reads the browser clock');
  // Reading an item never marks it: the only call of reading.mark is behind the page's own button.
  assert.equal([...controller.matchAll(/TOOL\.mark\b/g)].length, 2, 'reading.mark appears in the button condition and in its one write');
  assert.equal([...controller.matchAll(/markRead\(/g)].length, 2, 'the write is defined once and called from the button only');
});

test('the full-window dataset is valid at its clock, declared, and counted by its coverage report', () => {
  // datasets/full-window is the evaluation dataset (2025-01-01 to 2026-12-31); fixtures/minimal.json
  // stays the smoke fixture. `node dev/dataset.cjs --check` rebuilds it from its seed, and
  // tests/dataset.integration.cjs loads it through the public runtime.
  const dir = path.join(__dirname, '../datasets/full-window'), bytes = fs.readFileSync(path.join(dir, 'seed.json')), seed = JSON.parse(bytes);
  const clock = JSON.parse(fs.readFileSync(path.join(dir, 'clock.json'), 'utf8')).initial_time, declared = JSON.parse(fs.readFileSync(path.join(dir, 'dataset.json'), 'utf8'));
  const app = fixture({ seed, now: clock });                                   // seed schema and seed rules
  const { compile } = require('./schema-validator.cjs');
  assert.ok(compile(require('../schemas/dataset.schema.json'), path.join(__dirname, '../schemas'))(declared), 'dataset.json matches the dataset contract');
  assert.deepEqual([declared.dataset_id, declared.sources.map(s => s.kind), declared.expected_counts], ['belltower-full-window', ['synthetic'], { records: plugin.objects(seed).length, assets: 0 }]);
  assert.ok(declared.transformations[0].includes(require('node:crypto').createHash('sha256').update(bytes).digest('hex')), 'dataset.json names the SHA-256 of seed.json');
  assert.ok(bytes.length < 1.6 * 1024 * 1024, 'one env.load_seed request stays well inside the 2 MiB MCP message limit');
  // The coverage report is current: a fresh count over these files gives the committed report.
  const coverage = require('../dev/coverage.cjs').count().json;
  assert.deepEqual(coverage, JSON.parse(fs.readFileSync(path.join(dir, 'coverage.json'), 'utf8')));
  assert.ok(coverage.global.actions_only.distinct_dates >= 300 && coverage.global.actions_only.earliest === '2025-01-01' && coverage.global.actions_only.latest === '2026-12-31');
  assert.deepEqual(coverage.invalid_or_missing_dates, []);
  // Reads at the clock: nothing received after it, and the first month as the report counts it.
  assert.equal(app.call('items.list', { start: clock }).items.length, 0);
  const jan = app.call('items.list', { start: at('2025-01-01', '00:00'), end: at('2025-02-01', '00:00'), limit: 100 }).items;
  assert.deepEqual([jan.filter(i => i.matched_revisions.includes(1)).length], [coverage.monthly[0].publications]);
});

test('the package runs on its own: no import or file path leaves its folder', () => {
  const root = path.resolve(__dirname, '..'), files = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.(cjs|js|mjs)$/.test(e.name)) files.push(f); } };
  walk(root);
  assert.ok(files.length >= 20);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8'), rel = path.relative(root, file);
    for (const m of text.matchAll(/require\(\s*(['"`])([^'"`]+)\1\s*\)/g)) {
      const target = m[2];
      if (target.startsWith('node:')) continue;
      assert.ok(target.startsWith('.'), rel + ' requires ' + target + ': only Node built-ins and package files are allowed');
      const resolved = path.resolve(path.dirname(file), target);
      assert.ok(resolved === root || resolved.startsWith(root + path.sep), rel + ' requires a file outside the package: ' + target);
    }
    // A literal path may climb at most to the package root (the file's own depth below it).
    const depth = rel.split(path.sep).length - 1;
    for (const m of text.matchAll(/['"`](\.\.(?:\/[^'"`]*)?)['"`]/g)) {
      const parts = m[1].split('/'), climbs = parts.findIndex(x => x !== '..');
      assert.ok((climbs === -1 ? parts.length : climbs) <= depth, rel + ' has a path that leaves the package: ' + m[0]);
    }
  }
  // The business entrypoint and everything under src/ never touch the file system, the network or a child process, and never read a wall clock.
  for (const file of files.filter(f => path.relative(root, f).startsWith('src' + path.sep) || path.relative(root, f) === 'plugin.cjs')) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /node:(fs|child_process|net|http|https|dgram|worker_threads)|Date\.now\(|new Date\(\)|setTimeout|setInterval/, path.relative(root, file));
  }
});
