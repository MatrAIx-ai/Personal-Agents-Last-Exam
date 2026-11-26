'use strict';
// App-only business tests. Test names carry the proposal's acceptance IDs (T01-T13).
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const scenario = require('../examples/scenario.json');
const seed = require('../fixtures/minimal.json');
const clock = require('../fixtures/clock.json').initial_time;
const inesSeed = require('../examples/task-data/seed.json');
const inesBinding = require('../examples/task-data/binding.json');
const ev = name => structuredClone(require('../examples/events/' + name + '.json'));
const PT = (date, time) => date + 'T' + time + ':00-08:00';
function unchanged(f, fn, pattern) {const before = f.text; assert.throws(fn, pattern); assert.equal(f.text, before);}
const code = c => ({code: c});
const search = (f, args) => Object.fromEntries(f.call('kinodex.offers.search', args).results.map(x => [x.name, x]));
const withPayload = (event, fields) => ({...structuredClone(event), payload: {...structuredClone(event.payload), ...fields}});
const titleId = name => seed.titles.find(t => t.name === name).title_id;

// ---- W1 titles, credits and guides ------------------------------------------------------
test('T01 Lantern Hill guide: version 2 by default, version 1 on request, spoiler item only when unfiltered', () => {
  const f = fixture();
  f.event(scenario);
  const v2 = f.call('kinodex.guide.get', {title_id: 'tt-lantern-hill'}).guide;
  const v1 = f.call('kinodex.guide.get', {title_id: 'tt-lantern-hill', version: 1}).guide;
  assert.equal(v2.version, 2); assert.equal(v2.current_version, 2); assert.equal(v2.reason, 'correction_approved'); assert.equal(v2.published_at, scenario.at);
  assert.equal(v1.version, 1); assert.equal(v1.reason, 'seed');
  for (const cat of ['violence', 'frightening']) {assert.equal(v1.categories[cat].severity, 'mild'); assert.equal(v2.categories[cat].severity, 'moderate');}
  assert.deepEqual(v2.versions.map(v => v.version), [1, 2]);
  assert.ok(v2.categories.frightening.items.some(i => i.item_id === 'gi-lh-barn' && i.spoiler), 'Unfiltered version 2 includes the barn item');
  const safe = f.call('kinodex.guide.get', {title_id: 'tt-lantern-hill', hide_spoilers: true}).guide;
  assert.equal(safe.categories.frightening.severity, 'moderate');
  assert.equal(safe.categories.frightening.summary, 'Sustained child peril.');
  assert.equal(safe.categories.frightening.withheld_items, 1);
  assert.doesNotMatch(JSON.stringify(safe), /barn|trapped/i);
  const title = f.call('kinodex.titles.get', {title_id: 'tt-lantern-hill', hide_spoilers: true}).title;
  assert.equal(title.certification, 'PG'); assert.equal(title.releases.find(r => r.region === 'US').certification, 'PG');
  assert.doesNotMatch(JSON.stringify(title), /barn/i);
  unchanged(f, () => f.call('kinodex.titles.get', {title_id: 'tt-no-such-title'}), code('not_found'));
  unchanged(f, () => f.call('kinodex.guide.get', {title_id: 'tt-lantern-hill', version: 3}), code('not_found'));
  unchanged(f, () => f.call('kinodex.people.get', {person_id: 'pp-9999'}), code('not_found'));
});

test('T01 titles, editions, credits and people are searchable and consistent', () => {
  const f = fixture();
  const found = f.call('kinodex.titles.search', {query: 'salt year'}).titles;
  assert.equal(found[0].title_id, 'tt-salt-year');
  const salt = f.call('kinodex.titles.get', {title_id: 'tt-salt-year'}).title;
  assert.deepEqual(salt.editions.map(e => [e.label, e.runtime_minutes]), [['Theatrical', 118], ['Extended', 142]]);
  assert.equal(salt.episodes.length, 0); assert.equal(salt.spoiler_boundary, null);
  const credits = f.call('kinodex.credits.list', {title_id: 'tt-salt-year'}).credits;
  assert.deepEqual(credits.map(c => c.billing_order), credits.map((_, i) => i + 1));
  const director = f.call('kinodex.credits.list', {title_id: 'tt-salt-year', role: 'director'}).credits[0];
  const person = f.call('kinodex.people.get', {person_id: director.person_id});
  assert.ok(person.credits.some(c => c.title_id === 'tt-salt-year' && c.role === 'director'));
  assert.equal(f.call('kinodex.titles.search', {kind: 'series', limit: 100}).total, 24);
  assert.equal(f.call('kinodex.titles.search', {on_watchlist: true, limit: 100}).total, 14);
  assert.equal(f.call('kinodex.titles.search', {query: 'zeppelin'}).total, 0);
});

test('T02 Harbor Lights: synopses up to the furthest logged episode, spoiler items withheld, boundary moves back on delete', () => {
  const f = fixture();
  const get = () => f.call('kinodex.titles.get', {title_id: 'tt-harbor-lights', hide_spoilers: true}).title;
  let t = get();
  assert.equal(t.spoiler_boundary.furthest_episode, null);
  assert.ok(t.episodes.every(e => e.synopsis === null && e.synopsis_withheld), 'Nothing logged yet: every synopsis is withheld');
  assert.equal(t.guide.categories.violence.withheld_items, 1);
  assert.doesNotMatch(JSON.stringify(t), /sabotaged/);
  const e1 = f.call('kinodex.diary.log', {title_id: 'tt-harbor-lights', episode_ids: ['ep-harbor-lights-s1e1'], watched_on: '2026-11-27', watched_with: ['person-jules'], rating: 3.5}).id;
  const e2 = f.call('kinodex.diary.log', {title_id: 'tt-harbor-lights', episode_ids: ['ep-harbor-lights-s1e2'], watched_on: '2026-11-28', watched_with: ['person-jules'], rating: 4}).id;
  t = get();
  assert.deepEqual(t.spoiler_boundary, {person_id: 'person-dana', furthest_episode: {episode_id: 'ep-harbor-lights-s1e2', season_number: 1, number: 2}});
  assert.deepEqual(t.episodes.filter(e => e.synopsis !== null).map(e => e.episode_id), ['ep-harbor-lights-s1e1', 'ep-harbor-lights-s1e2']);
  assert.ok(t.episodes.slice(2).every(e => e.synopsis_withheld));
  const open = f.call('kinodex.titles.get', {title_id: 'tt-harbor-lights'}).title;
  assert.ok(open.episodes.every(e => e.synopsis !== null) && open.guide.categories.violence.items.length === 2, 'Unfiltered reads show everything');
  // After deleting the second episode's entry, the boundary moves back to episode 1.
  f.call('kinodex.diary.delete', {id: e2});
  t = get();
  assert.equal(t.spoiler_boundary.furthest_episode.episode_id, 'ep-harbor-lights-s1e1');
  assert.deepEqual(t.episodes.filter(e => e.synopsis !== null).map(e => e.episode_id), ['ep-harbor-lights-s1e1']);
  f.call('kinodex.diary.delete', {id: e1});
  assert.equal(get().spoiler_boundary.furthest_episode, null);
  const season2 = f.call('kinodex.episodes.list', {title_id: 'tt-harbor-lights', season_number: 2, hide_spoilers: true}).episodes;
  assert.equal(season2.length, 6); assert.ok(season2.every(e => e.synopsis_withheld));
  unchanged(f, () => f.call('kinodex.episodes.list', {title_id: 'tt-harbor-lights', season_number: 9}), code('not_found'));
  unchanged(f, () => f.call('kinodex.episodes.list', {title_id: 'tt-salt-year'}), code('not_found'));
});

test('T02 Mira has no diary: her boundary comes from Dana\'s entries whose watched_with includes her', () => {
  const f = fixture();
  const boundary = person => f.call('kinodex.episodes.list', {title_id: 'tt-pocket-comets', hide_spoilers: true, ...(person ? {as_of_person: person} : {})});
  const mira = boundary('person-mira'), dana = boundary(), jules = boundary('person-jules');
  assert.equal(mira.spoiler_boundary.furthest_episode.number, 4, 'Mira watched episodes 1-4 with Dana');
  assert.equal(dana.spoiler_boundary.furthest_episode.number, 5, 'Dana watched episode 5 with Jules only');
  assert.equal(jules.spoiler_boundary.furthest_episode.number, 5);
  assert.deepEqual(mira.episodes.filter(e => e.synopsis !== null).map(e => e.number), [1, 2, 3, 4]);
  assert.deepEqual(dana.episodes.filter(e => e.synopsis !== null).map(e => e.number), [1, 2, 3, 4, 5]);
  unchanged(f, () => boundary('person-nobody'), code('not_found'));
  const people = f.call('kinodex.account.get').people;
  assert.deepEqual(people.map(p => p.person_id).sort(), ['person-dana', 'person-jules', 'person-mira']);
});

// ---- W2 where to watch ------------------------------------------------------------------
test('T03 on my services: Fieldglass stays available on Northcast, Copper Sky is leaving_soon then only a rental, UK-only offers are excluded', () => {
  const f = fixture();
  const ids = f.call('kinodex.watchlist.get').items.map(i => i.title_id);
  let r = search(f, {title_ids: ids, on_my_services: true});
  const leaving = Object.values(r).filter(x => x.my_subscriptions.status === 'leaving_soon').map(x => x.name);
  assert.deepEqual(leaving, ['Copper Sky', 'Quiet Harbour']);
  assert.equal(r.Fieldglass.my_subscriptions.status, 'available');
  assert.deepEqual(r.Fieldglass.offers.map(o => [o.service_id, o.availability]), [['brightreel', 'leaving_soon'], ['northcast', 'available']]);
  assert.equal(r['Copper Sky'].my_subscriptions.available_until, '2026-12-04T23:59:00-08:00');
  assert.ok(r['Quiet Harbour'].offers.every(o => o.region === 'US'), 'The UK-only Northcast offer is not returned for a US account');
  assert.ok(search(f, {title_ids: ['tt-quiet-harbour'], region: 'UK'})['Quiet Harbour'].offers.some(o => o.service_id === 'northcast'));
  // The clock alone moves offers between states.
  f.advance(PT('2026-12-03', '09:00'));
  r = search(f, {title_ids: ids, on_my_services: true});
  assert.equal(r.Fieldglass.my_subscriptions.status, 'available');
  assert.deepEqual(r.Fieldglass.offers.map(o => o.service_id), ['northcast'], 'The ended Brightreel offer drops out');
  f.advance(PT('2026-12-05', '09:00'));
  r = search(f, {title_ids: ['tt-copper-sky'], on_my_services: true});
  assert.equal(r['Copper Sky'].my_subscriptions.status, 'none');
  assert.deepEqual(r['Copper Sky'].offers.map(o => [o.service_id, o.type, o.price]), [['brightreel', 'rent', 4.99]], 'Only a rental remains');
  assert.deepEqual(search(f, {title_ids: ['tt-copper-sky']})['Copper Sky'].offers.map(o => o.type), ['rent', 'free_with_ads'], 'Across US services: the rental and Openfern ads, no purchase');
  const lantern = f.call('kinodex.offers.for_title', {title_id: 'tt-lantern-hill', region: 'US'}).result;
  assert.deepEqual(lantern.offers.map(o => [o.service_id, o.type, o.availability, o.available_until, o.price]),
    [['brightreel', 'subscription', 'leaving_soon', '2026-12-05T23:59:00-08:00', null], ['brightreel', 'rent', 'available', null, 3.99]]);
});

test('T03 clock-only changes: offer end, the seven-day window and alert expiry change reads but write no activity or notice', () => {
  const f = fixture();
  const state = () => ({offer: f.call('kinodex.offers.for_title', {title_id: 'tt-marrow-bay', region: 'US'}).result.offers.find(o => o.type === 'subscription')?.availability,
    alert: f.call('kinodex.alerts.list', {title_id: 'tt-marrow-bay'}).alerts[0].status,
    found: f.call('kinodex.offers.search', {query: 'marrow bay', on_my_services: true, types: ['subscription']}).total});
  const before = f.text;
  assert.deepEqual(state(), {offer: 'available', alert: 'active', found: 1});
  f.advance(PT('2026-12-03', '09:00'));
  assert.deepEqual(state(), {offer: 'leaving_soon', alert: 'expired', found: 1}, 'Inside seven days; al-04 reached expires_at (Dec 2 noon)');
  f.advance(PT('2026-12-10', '09:00'));
  assert.deepEqual(state(), {offer: undefined, alert: 'expired', found: 0}, 'Ended offers drop out of search and for_title');
  assert.equal(f.call('kinodex.offers.for_title', {title_id: 'tt-marrow-bay', include_ended: true}).result.offers[0].availability, 'ended');
  assert.equal(f.text, before, 'No activity row, notice or stored status was written');
});

test('T04 services.update adding a subscribed service triggers an active return alert once, with offer, cause and request ID and no notice', () => {
  const f = fixture({virtual_now: PT('2026-12-07', '09:00')});
  const alert = f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-quiet-harbour'}).alert;
  const notices = f.data.notices.length;
  const out = f.call('kinodex.services.update', {patch: {service_ids: ['brightreel', 'northcast', 'plumvale']}, expected_settings_version: 3, request_id: 'add-plumvale'});
  assert.equal(out.settings_version, 4);
  const plumvale = seed.offers.find(o => o.title_id === 'tt-quiet-harbour' && o.service_id === 'plumvale');
  assert.deepEqual(out.triggered_alerts, [{alert_id: alert.alert_id, title_id: 'tt-quiet-harbour', offer_id: plumvale.offer_id}]);
  const stored = f.data.alerts.find(a => a.alert_id === alert.alert_id);
  assert.equal(stored.status, 'triggered');
  assert.deepEqual({...stored.trigger, offer: stored.trigger.offer.offer_id},
    {at: f.ctx.virtual_now, cause: 'services.update', event_id: null, operation: null, request_id: 'add-plumvale', offer: plumvale.offer_id, season_number: null, notice_id: null});
  assert.equal(f.data.notices.length, notices, 'The agent\'s own write emits no notice');
  assert.deepEqual(f.data.activity.at(-1).effects, {alert_ids: [alert.alert_id], notice_ids: []});
  // A later account change does not trigger the rule again.
  f.call('kinodex.services.update', {patch: {service_ids: ['northcast', 'plumvale']}});
  f.call('kinodex.services.update', {patch: {service_ids: ['brightreel', 'northcast', 'plumvale']}});
  assert.deepEqual(f.data.alerts.find(a => a.alert_id === alert.alert_id).trigger, stored.trigger);
  unchanged(f, () => f.call('kinodex.services.update', {patch: {region: 'UK'}, expected_settings_version: 3}), code('object_version_conflict'));
  unchanged(f, () => f.call('kinodex.services.update', {patch: {service_ids: ['brightreel', 'nowhere-tv']}}), code('not_found'));
  unchanged(f, () => f.call('kinodex.services.update', {patch: {region: 'US'}}), code('no_change'));
  unchanged(f, () => f.call('kinodex.services.update', {patch: {service_ids: ['plumvale', 'northcast', 'brightreel']}}), code('no_change'));
  unchanged(f, () => f.call('kinodex.services.update', {patch: {region: 'FR'}}), code('not_found'));
  unchanged(f, () => f.call('kinodex.offers.search', {region: 'FR'}), code('not_found'));
  unchanged(f, () => f.call('kinodex.offers.for_title', {title_id: 'tt-copper-sky', region: 'FR'}), code('not_found'));
});

test('T04 services.update switching to a region with a matching offer triggers the rule; a stale update changes nothing', () => {
  const f = fixture({virtual_now: PT('2026-12-07', '09:00')});
  const qh = f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-quiet-harbour'}).id;
  const cs = f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-copper-sky'}).id;
  const before = f.text;
  unchanged(f, () => f.call('kinodex.services.update', {patch: {region: 'UK'}, expected_settings_version: 2}), code('object_version_conflict'));
  assert.equal(f.text, before, 'Region, subscriptions, rule state and notices are preserved');
  const out = f.call('kinodex.services.update', {patch: {region: 'UK'}});
  assert.deepEqual(out.triggered_alerts.map(a => a.alert_id).sort(), [cs, qh].sort());
  assert.ok(out.triggered_alerts.every(a => seed.offers.find(o => o.offer_id === a.offer_id).region === 'UK'));
  assert.equal(f.data.notices.length, seed.notices.length);
});

// ---- W3 watchlist, diary, ratings and lists -----------------------------------------------
test('T05 watchlist.save moves two titles to the top at watchlist version 2; stale or unknown input changes nothing', () => {
  const f = fixture();
  const current = f.call('kinodex.watchlist.get');
  assert.equal(current.watchlist_version, 1); assert.equal(current.items.length, 14);
  const rest = current.items.map(i => i.title_id).filter(id => id !== 'tt-copper-sky' && id !== 'tt-quiet-harbour');
  const saved = f.call('kinodex.watchlist.save', {title_ids: ['tt-copper-sky', 'tt-quiet-harbour', ...rest], expected_watchlist_version: 1});
  assert.deepEqual(saved, {id: 'watchlist', watchlist_version: 2, count: 14});
  const after = f.call('kinodex.watchlist.get');
  assert.equal(after.watchlist_version, 2);
  assert.deepEqual(after.items.map(i => i.title_id), ['tt-copper-sky', 'tt-quiet-harbour', ...rest]);
  unchanged(f, () => f.call('kinodex.watchlist.save', {title_ids: rest, expected_watchlist_version: 1}), code('object_version_conflict'));
  unchanged(f, () => f.call('kinodex.watchlist.save', {title_ids: ['tt-no-such-title']}), code('not_found'));
  unchanged(f, () => f.call('kinodex.watchlist.save', {title_ids: after.items.map(i => i.title_id)}), code('no_change'));
  assert.deepEqual(f.data.activity.map(a => [a.action, a.object_id, a.replaced.version]), [['kinodex.watchlist.save', 'watchlist', 1]]);
});

test('T05 custom lists keep their own list_version', () => {
  const f = fixture();
  assert.deepEqual(f.call('kinodex.lists.list').lists.map(l => [l.list_id, l.list_version]), [['ls-01', 1], ['ls-02', 3], ['ls-03', 2]]);
  const id = f.call('kinodex.lists.create', {name: 'Trip watch', title_ids: ['tt-salt-year']}).id;
  assert.deepEqual(f.call('kinodex.lists.save', {id, patch: {title_ids: ['tt-pellmoor-junction', 'tt-salt-year']}, expected_list_version: 1}),
    {id, list_version: 2, changed_fields: ['title_ids']});
  unchanged(f, () => f.call('kinodex.lists.save', {id, patch: {name: 'Old'}, expected_list_version: 1}), code('object_version_conflict'));
  unchanged(f, () => f.call('kinodex.lists.save', {id, patch: {name: 'Trip watch'}}), code('no_change'));
  unchanged(f, () => f.call('kinodex.lists.save', {id: 'ls-99', patch: {name: 'x'}}), code('not_found'));
  assert.deepEqual(f.call('kinodex.lists.get', {list_id: id}).list.items.map(i => i.title_id), ['tt-pellmoor-junction', 'tt-salt-year']);
  f.call('kinodex.lists.delete', {id});
  unchanged(f, () => f.call('kinodex.lists.get', {list_id: id}), code('not_found'));
});

test('T06 logging the trip: five entries with watched_with, one rewatch, the extended Salt Year edition, Dana\'s rating style', () => {
  const f = fixture();
  const history = f.call('kinodex.diary.list', {title_id: 'tt-wrenfield-clock'}).entries;
  assert.deepEqual(history.map(e => e.watched_on), ['2025-11-14'], 'One of the three flight films was seen in November 2025');
  const log = args => f.call('kinodex.diary.log', {watched_with: ['person-jules'], ...args}).entry;
  const logged = [
    log({title_id: 'tt-salt-year', edition_id: 'ed-salt-year-extended', watched_on: '2026-11-26', rating: 3.5}),
    log({title_id: 'tt-wrenfield-clock', watched_on: '2026-11-26', rewatch: true, rating: 4}),
    log({title_id: 'tt-pellmoor-junction', watched_on: '2026-11-26', rating: 3}),
    log({title_id: 'tt-harbor-lights', episode_ids: ['ep-harbor-lights-s1e1'], watched_on: '2026-11-27', rating: 3.5}),
    log({title_id: 'tt-harbor-lights', episode_ids: ['ep-harbor-lights-s1e2'], watched_on: '2026-11-28', rating: 4}),
  ];
  assert.ok(logged.every(e => e.watched_with.includes('person-jules')));
  assert.deepEqual(logged.filter(e => e.rewatch).map(e => e.title_id), ['tt-wrenfield-clock']);
  assert.equal(logged[0].edition_id, 'ed-salt-year-extended');
  const recent = f.call('kinodex.diary.list', {from: '2026-11-26'}).entries;
  assert.deepEqual(recent.map(e => e.entry_id), [logged[4], logged[3], logged[2], logged[1], logged[0]].map(e => e.entry_id),
    'Latest first; the three films logged for one date keep their logging order, latest first');
  assert.equal(f.data.corrections.length, seed.corrections.length, 'Logging submits no correction');
  const ratings = f.data.diary.map(e => e.rating).filter(x => x !== null);
  assert.ok(ratings.every(x => Number.isInteger(x * 2) && x < 5));
});

test('T06 diary rules: future dates, pre-release dates, off-scale ratings and wrong episodes change nothing', () => {
  const f = fixture();
  const base = {title_id: 'tt-salt-year', watched_on: '2026-11-26'};
  unchanged(f, () => f.call('kinodex.diary.log', {...base, watched_on: '2026-12-02'}), code('invalid_date'));
  unchanged(f, () => f.call('kinodex.diary.log', {...base, watched_on: '2025-05-08'}), code('invalid_date'));
  unchanged(f, () => f.call('kinodex.diary.log', {...base, watched_on: '2026-02-30'}), code('invalid_date'));
  unchanged(f, () => f.call('kinodex.diary.log', {title_id: 'tt-harbor-lights', episode_ids: ['ep-harbor-lights-s2e6'], watched_on: '2026-10-08'}), code('invalid_date'));
  for (const rating of [3.3, 0, 5.5, -1]) unchanged(f, () => f.call('kinodex.diary.log', {...base, rating}), code('invalid_rating'));
  unchanged(f, () => f.call('kinodex.diary.log', {title_id: 'tt-harbor-lights', episode_ids: ['ep-pocket-comets-s1e1'], watched_on: '2026-11-26'}), code('not_found'));
  unchanged(f, () => f.call('kinodex.diary.log', {title_id: 'tt-harbor-lights', watched_on: '2026-11-26'}), code('invalid_arguments'));
  unchanged(f, () => f.call('kinodex.diary.log', {...base, edition_id: 'ed-lantern-hill-theatrical'}), code('not_found'));
  unchanged(f, () => f.call('kinodex.diary.log', {...base, watched_with: ['person-dana']}), code('invalid_arguments'));
  unchanged(f, () => f.call('kinodex.diary.log', {...base, watched_with: ['person-stranger']}), code('not_found'));
  assert.equal(f.call('kinodex.diary.log', {...base, watched_on: '2026-12-01', rating: 5}).entry.rating, 5, 'Today is allowed; 5 stars is on the scale');
});

test('T06 "today" is the date of the clock instant in the account time zone, however the clock is spelled', () => {
  // 2026-12-02T03:00:00Z is still Dec 1 in Los Angeles (Dana) and already Dec 2 in London (Ines).
  const dana = fixture({virtual_now: '2026-12-02T03:00:00Z'});
  unchanged(dana, () => dana.call('kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-12-02'}), /after today \(2026-12-01 in America\/Los_Angeles\)/);
  assert.equal(dana.call('kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-12-01'}).entry.watched_on, '2026-12-01');
  const ines = fixture({seed: inesSeed, binding: inesBinding, virtual_now: '2026-12-02T03:00:00Z'});
  assert.equal(ines.call('kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-12-02'}).entry.watched_on, '2026-12-02');
  assert.ok(!('time_zone' in dana.call('kinodex.account.get').account), 'The approved account.get output is unchanged');
  assert.throws(() => plugin.validateSeed(dana.ctx, {...dana.data, account: {...dana.data.account, time_zone: 'Mars/Olympus'}}), /IANA time zone/);
});

test('T07 editing and deleting diary entries; deleting returns the removed rating and review', () => {
  const f = fixture();
  const reviewed = seed.diary.find(e => e.review && e.episode_ids.length === 0);
  const up = f.call('kinodex.diary.update', {id: reviewed.entry_id, patch: {rating: 2.5}});
  assert.deepEqual(up.changed_fields, ['rating']); assert.equal(up.entry.rating, 2.5);
  unchanged(f, () => f.call('kinodex.diary.update', {id: reviewed.entry_id, patch: {rating: 2.5}}), code('no_change'));
  unchanged(f, () => f.call('kinodex.diary.update', {id: reviewed.entry_id, patch: {rating: 3.3}}), code('invalid_rating'));
  unchanged(f, () => f.call('kinodex.diary.update', {id: reviewed.entry_id, patch: {watched_on: '2027-01-01'}}), code('invalid_date'));
  unchanged(f, () => f.call('kinodex.diary.update', {id: 'de-9999', patch: {rating: 3}}), code('not_found'));
  const removed = f.call('kinodex.diary.delete', {id: reviewed.entry_id});
  assert.deepEqual(removed.removed, {title_id: reviewed.title_id, episode_ids: [], watched_on: reviewed.watched_on, rating: 2.5, review: reviewed.review});
  assert.ok(!f.data.diary.some(e => e.entry_id === reviewed.entry_id));
  assert.equal(f.data.activity.at(-1).replaced.rating, 2.5);
  unchanged(f, () => f.call('kinodex.diary.delete', {id: reviewed.entry_id}), code('not_found'));
});

test('T07 reviews: own and public reviews, with spoiler text withheld on request', () => {
  const f = fixture();
  const all = f.call('kinodex.reviews.list', {title_id: 'tt-lantern-hill'}).reviews;
  assert.ok(all.some(r => r.contains_spoilers && /barn/.test(r.text)));
  const safe = f.call('kinodex.reviews.list', {title_id: 'tt-lantern-hill', hide_spoilers: true}).reviews;
  assert.ok(safe.every(r => !r.contains_spoilers || (r.text === null && r.text_withheld)));
  assert.doesNotMatch(JSON.stringify(safe), /barn/);
  const mine = f.call('kinodex.reviews.list', {source: 'mine', limit: 200}).reviews;
  assert.ok(mine.length > 10 && mine.every(r => r.source === 'mine' && r.author === 'Dana Marsh'));
});

// ---- W4 alerts --------------------------------------------------------------------------
test('T08 return alert for Copper Sky: already_true while on Brightreel, active after; ads and UK offers do not fire; the Northcast return fires once', () => {
  const f = fixture();
  const create = title_id => f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id});
  unchanged(f, () => create('tt-copper-sky'), /already_true|Already true: offer of-\d+ \(Brightreel, subscription, US/);
  unchanged(f, () => create('tt-copper-sky'), code('already_true'));
  f.advance(PT('2026-12-07', '09:00'));
  const rule = create('tt-copper-sky').alert;
  assert.equal(rule.status, 'active');
  unchanged(f, () => create('tt-fieldglass'), code('already_true'));
  // US free_with_ads on a subscribed service, a UK-only subscription and US ads on an unsubscribed service leave it active.
  f.event(ev('copper-sky-northcast-ads'));
  f.event(withPayload(ev('copper-sky-northcast-ads'), {offer_id: 'of-copper-sky-northcast-uk-2', region: 'UK', type: 'subscription', quality: 'HD'}));
  assert.equal(f.call('kinodex.alerts.list', {title_id: 'tt-copper-sky'}).alerts[0].status, 'active');
  assert.equal(f.data.notices.length, seed.notices.length);
  const restore = ev('copper-sky-northcast-return');
  f.event(restore);
  const fired = f.call('kinodex.alerts.list', {title_id: 'tt-copper-sky'}).alerts[0];
  assert.equal(fired.status, 'triggered');
  assert.deepEqual([fired.trigger.cause, fired.trigger.event_id, fired.trigger.operation, fired.trigger.offer.offer_id, fired.trigger.offer.service_id],
    ['event', 'copper-sky-northcast-return', 'offer.publish', 'of-copper-sky-northcast-us-2026-12', 'northcast']);
  const notices = f.call('kinodex.notices.list', {kind: 'alert_triggered'}).notices;
  assert.equal(notices[0].notice_id, fired.trigger.notice_id);
  assert.match(notices[0].text, /Copper Sky is now included with your Northcast subscription in the US/);
  // A second matching event adds no alert notice and leaves the recorded trigger as it was.
  const trigger = f.data.alerts.find(a => a.alert_id === rule.alert_id).trigger;
  f.event({...withPayload(restore, {offer_id: 'of-copper-sky-northcast-us-2026-12b', available_from: '2026-12-11T06:00:00-08:00'}), event_id: 'copper-sky-again', at: '2026-12-11T06:00:00-08:00'});
  assert.equal(f.call('kinodex.notices.list', {kind: 'alert_triggered'}).notices.length, notices.length);
  assert.deepEqual(f.data.alerts.find(a => a.alert_id === rule.alert_id).trigger, trigger);
  assert.deepEqual(f.data.activity.at(-1).effects, {alert_ids: [], notice_ids: []});
});

test('T08 item 2: an upcoming offer that starts by the clock alone fires nothing until an event delivers it', () => {
  const f = fixture();
  const rule = f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-ambervane'}).alert;
  assert.equal(rule.status, 'active', 'Upcoming offers do not make a rule already_true');
  const before = f.text;
  f.advance(PT('2026-12-03', '10:00'));
  assert.equal(f.call('kinodex.offers.for_title', {title_id: 'tt-ambervane', region: 'US'}).result.my_subscriptions.status, 'available');
  assert.equal(f.call('kinodex.alerts.list', {title_id: 'tt-ambervane'}).alerts[0].status, 'active');
  assert.equal(f.text, before, 'No trigger, notice or activity row from time passing');
  unchanged(f, () => f.call('kinodex.alerts.update', {id: rule.alert_id, patch: {expires_at: '2027-01-01T00:00:00Z'}}), code('already_true'));
  f.event(ev('ambervane-northcast-start'));
  const fired = f.call('kinodex.alerts.list', {title_id: 'tt-ambervane'}).alerts[0];
  assert.deepEqual([fired.status, fired.trigger.event_id, fired.trigger.at], ['triggered', 'ambervane-northcast-start', '2026-12-03T10:00:00-08:00']);
  assert.equal(f.data.notices.filter(n => n.alert_id === rule.alert_id).length, 1);
});

test('T08 new_season and price_below rules', () => {
  const f = fixture();
  const ns = f.call('kinodex.alerts.create', {kind: 'new_season', title_id: 'tt-harbor-lights'}).alert;
  assert.deepEqual([ns.status, ns.known_seasons], ['active', [1, 2]]);
  f.event({event_id: 'harbor-lights-s2-extra', at: PT('2026-12-02', '08:00'), operation: 'title.update', payload: {title_id: 'tt-harbor-lights',
    add_episodes: [{season_number: 2, episode_id: 'ep-harbor-lights-s2e7', number: 7, name: 'Coda', synopsis: 'A short epilogue at the harbour.', air_date: '2026-12-04', runtime_minutes: 30}]}});
  assert.equal(f.call('kinodex.alerts.list', {title_id: 'tt-harbor-lights'}).alerts[0].status, 'active', 'More episodes of an existing season do not match');
  f.event(ev('harbor-lights-season-3'));
  const fired = f.call('kinodex.alerts.list', {title_id: 'tt-harbor-lights'}).alerts[0];
  assert.deepEqual([fired.status, fired.trigger.season_number, fired.trigger.offer], ['triggered', 3, null]);
  assert.match(f.data.notices.at(-1).text, /Harbor Lights season 3 has been added/);
  const pb = f.call('kinodex.alerts.create', {kind: 'price_below', title_id: 'tt-salt-year', offer_type: 'buy', threshold: 10}).alert;
  const buy = seed.offers.find(o => o.title_id === 'tt-salt-year' && o.type === 'buy');
  assert.deepEqual([buy.service_id, buy.region, buy.price], ['tinlark', 'US', 17.99]);
  f.event({event_id: 'salt-year-buy-drop', at: PT('2026-12-12', '06:00'), operation: 'offer.publish', payload: {...buy, price: 9.99}});
  const dropped = f.data.alerts.find(a => a.alert_id === pb.alert_id);
  assert.deepEqual([dropped.status, dropped.trigger.offer.offer_id, dropped.trigger.offer.price], ['triggered', buy.offer_id, 9.99]);
  assert.match(f.data.notices.at(-1).text, /Salt Year can now be bought for \$9\.99 on Tinlark Store \(below your \$10\.00 alert\)/);
});

test('T09 alert controls: duplicate_alert, invalid_threshold, not_active, expiry and an event at the expiry time', () => {
  const f = fixture({virtual_now: PT('2026-12-07', '09:00')});
  const rule = f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-copper-sky', expires_at: '2026-12-10T06:00:00-08:00'}).alert;
  unchanged(f, () => f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-copper-sky'}), code('duplicate_alert'));
  unchanged(f, () => f.call('kinodex.alerts.create', {kind: 'price_below', title_id: 'tt-fieldglass', offer_type: 'rent', threshold: 3}), code('invalid_threshold'));
  unchanged(f, () => f.call('kinodex.alerts.create', {kind: 'price_below', title_id: 'tt-copper-sky', offer_type: 'buy', threshold: 10}),
    /Copper Sky has no current or upcoming buy offer in US, so a price threshold cannot apply/);
  unchanged(f, () => f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-quiet-harbour', threshold: 3}), code('invalid_threshold'));
  unchanged(f, () => f.call('kinodex.alerts.create', {kind: 'price_below', title_id: 'tt-copper-sky', offer_type: 'rent', threshold: -1}), code('invalid_threshold'));
  unchanged(f, () => f.call('kinodex.alerts.create', {kind: 'new_season', title_id: 'tt-salt-year'}), code('invalid_arguments'));
  unchanged(f, () => f.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-quiet-harbour', expires_at: '2026-12-01T00:00:00Z'}), code('invalid_date'));
  unchanged(f, () => f.call('kinodex.alerts.update', {id: 'al-01', patch: {expires_at: null}}), code('not_active'));
  unchanged(f, () => f.call('kinodex.alerts.update', {id: 'al-04', patch: {threshold: 3}}), code('not_active'));
  unchanged(f, () => f.call('kinodex.alerts.delete', {id: 'al-03'}), code('not_active'));
  assert.deepEqual(f.call('kinodex.alerts.list').alerts.filter(a => a.alert_id.startsWith('al-')).map(a => [a.alert_id, a.status]),
    [['al-04', 'expired'], ['al-05', 'active'], ['al-03', 'deleted'], ['al-02', 'expired'], ['al-01', 'triggered']]);
  // The restoring event arrives exactly at expires_at: the rule stays expired and no alert notice is written.
  f.event(ev('copper-sky-northcast-return'));
  const after = f.call('kinodex.alerts.list', {title_id: 'tt-copper-sky'}).alerts[0];
  assert.deepEqual([after.status, after.trigger], ['expired', null]);
  assert.equal(f.data.notices.length, seed.notices.length);
  unchanged(f, () => f.call('kinodex.alerts.update', {id: rule.alert_id, patch: {expires_at: null}}), code('not_active'));
  const fresh = f.call('kinodex.alerts.create', {kind: 'new_season', title_id: 'tt-harbor-lights'}).id;
  assert.equal(f.call('kinodex.alerts.update', {id: fresh, patch: {expires_at: '2027-06-01T00:00:00Z'}}).alert.expires_at, '2027-06-01T00:00:00Z');
  assert.equal(f.call('kinodex.alerts.delete', {id: fresh}).alert.status, 'deleted');
});

// ---- W5 corrections ---------------------------------------------------------------------
test('T10 Salt Year runtime: 142 for the theatrical edition is accepted, for the extended edition is no_change; the verbatim decision declines it', () => {
  const f = fixture();
  const submit = (edition_id, value = 142) => f.call('kinodex.corrections.submit', {title_id: 'tt-salt-year', field: 'runtime', target: {edition_id},
    proposed_value: value, evidence: 'The in-flight edition ran 142 minutes.'});
  unchanged(f, () => submit('ed-salt-year-extended'), code('no_change'));
  const co = submit('ed-salt-year-theatrical').correction;
  assert.deepEqual([co.status, co.current_value, co.proposed_value], ['submitted', 118, 142]);
  unchanged(f, () => submit('ed-salt-year-theatrical', 140), code('already_submitted'));
  unchanged(f, () => submit('ed-lantern-hill-theatrical'), code('not_found'));
  const decision = ev('salt-year-runtime-decision');
  assert.deepEqual(decision.payload.correction_ref, {title_id: 'tt-salt-year', field: 'runtime'}, 'The approved example, verbatim');
  f.event(decision);
  const decided = f.call('kinodex.corrections.list', {title_id: 'tt-salt-year'}).corrections[0];
  assert.equal(decided.status, 'declined');
  assert.deepEqual(decided.decisions, [{decision: 'declined', note: decision.payload.note, decided_at: decision.at, event_id: decision.event_id}]);
  assert.equal(f.call('kinodex.titles.get', {title_id: 'tt-salt-year'}).title.editions[0].runtime_minutes, 118);
  assert.match(f.call('kinodex.notices.list', {kind: 'correction_decided'}).notices[0].text, /runtime correction for Salt Year \(ed-salt-year-theatrical\) was declined/);
  unchanged(f, () => f.call('kinodex.corrections.withdraw', {id: co.correction_id}), code('already_decided'));
  // The correction is closed, so a new one for the same target can be submitted.
  assert.equal(submit('ed-salt-year-theatrical', 120).correction.status, 'submitted');
});

test('T11 approved guide correction adds a guide version, a decision notice and a guide notice (watchlist title); needs_info is amended once; the pending credit correction is approved by its full key', () => {
  const f = fixture();
  const co = f.call('kinodex.corrections.submit', {title_id: 'tt-harbor-lights', field: 'guide_item', target: {item_id: 'gi-hl-storm'},
    proposed_value: {spoiler: true}, evidence: 'The storm scene shows who survives the ferry sinking.'}).correction;
  assert.deepEqual(co.current_value, {text: 'A long sequence of a small boat caught in a storm.', spoiler: false});
  const notices = f.data.notices.length;
  f.event({event_id: 'hl-storm-needs-info', at: PT('2026-12-02', '10:00'), operation: 'correction.decision',
    payload: {correction_ref: {title_id: 'tt-harbor-lights', field: 'guide_item', target: {item_id: 'gi-hl-storm'}}, decision: 'needs_info', note: 'Which episode?'}});
  assert.equal(f.data.corrections.at(-1).status, 'needs_info');
  f.advance(PT('2026-12-02', '12:00'));
  const amended = f.call('kinodex.corrections.amend', {id: co.correction_id, patch: {evidence: 'Season 1, episode 6: the storm scene shows who survives.'}}).correction;
  assert.deepEqual([amended.status, amended.amended_at], ['submitted', f.ctx.virtual_now]);
  unchanged(f, () => f.call('kinodex.corrections.amend', {id: co.correction_id, patch: {evidence: 'again'}}), code('already_submitted'));
  unchanged(f, () => f.event({event_id: 'hl-storm-needs-info-2', at: PT('2026-12-03', '10:00'), operation: 'correction.decision',
    payload: {correction_ref: {title_id: 'tt-harbor-lights', field: 'guide_item', target: {item_id: 'gi-hl-storm'}}, decision: 'needs_info'}}), code('invalid_event'));
  f.event({event_id: 'hl-storm-approved', at: PT('2026-12-03', '10:00'), operation: 'correction.decision',
    payload: {correction_ref: {title_id: 'tt-harbor-lights', field: 'guide_item', target: {item_id: 'gi-hl-storm'}}, decision: 'approved'}});
  const guide = f.call('kinodex.guide.get', {title_id: 'tt-harbor-lights'}).guide;
  assert.deepEqual([guide.version, guide.reason, guide.published_at], [2, 'correction_approved', PT('2026-12-03', '10:00')]);
  assert.equal(guide.categories.frightening.items.find(i => i.item_id === 'gi-hl-storm').spoiler, true);
  assert.equal(f.call('kinodex.guide.get', {title_id: 'tt-harbor-lights', hide_spoilers: true}).guide.categories.frightening.withheld_items, 1);
  assert.deepEqual(f.data.notices.slice(notices).map(n => [n.kind, n.event_id]), [['correction_decided', 'hl-storm-needs-info'], ['correction_decided', 'hl-storm-approved'],
    ['guide_updated', 'hl-storm-approved']], 'One notice per decision, plus a guide_updated notice because Harbor Lights is on the watchlist');
  assert.match(f.data.notices.at(-2).text, /was approved\. The parental guide is now at version 2\./);
  // The seeded pending credit correction, decided by its full key.
  const pending = seed.corrections.find(x => x.status === 'submitted');
  f.event({event_id: 'pellmoor-credit-approved', at: PT('2026-12-04', '10:00'), operation: 'correction.decision',
    payload: {correction_ref: {title_id: pending.title_id, field: 'credit', target: pending.target}, decision: 'approved', note: 'Fixed.'}});
  assert.equal(f.call('kinodex.credits.list', {title_id: 'tt-pellmoor-junction'}).credits.find(c => c.credit_id === pending.target.credit_id).character, 'Marta Kessling');
  const withdrawn = f.call('kinodex.corrections.submit', {title_id: 'tt-lantern-hill', field: 'certification', target: {region: 'US'}, proposed_value: 'PG-13', evidence: 'Board listing.'}).id;
  assert.equal(f.call('kinodex.corrections.withdraw', {id: withdrawn}).correction.status, 'withdrawn');
  unchanged(f, () => f.call('kinodex.corrections.withdraw', {id: withdrawn}), code('already_decided'));
  unchanged(f, () => f.call('kinodex.corrections.amend', {id: withdrawn, patch: {evidence: 'x'}}), code('already_decided'));
});

test('T12 decision lookups: no open correction or an ambiguous short form fails with target_not_found and changes nothing', () => {
  const f = fixture();
  unchanged(f, () => f.event(ev('salt-year-runtime-decision')), code('target_not_found'));
  const submit = (edition_id, value) => f.call('kinodex.corrections.submit', {title_id: 'tt-salt-year', field: 'runtime', target: {edition_id}, proposed_value: value, evidence: 'Disc case.'});
  submit('ed-salt-year-theatrical', 120); submit('ed-salt-year-extended', 150);
  unchanged(f, () => f.event(ev('salt-year-runtime-decision')), /2 open runtime corrections match/);
  f.event({...ev('salt-year-runtime-decision'), payload: {...ev('salt-year-runtime-decision').payload,
    correction_ref: {title_id: 'tt-salt-year', field: 'runtime', target: {edition_id: 'ed-salt-year-extended'}}}});
  assert.deepEqual(f.data.corrections.filter(c => c.title_id === 'tt-salt-year').map(c => c.status), ['submitted', 'declined']);
  unchanged(f, () => f.call('kinodex.corrections.submit', {title_id: 'tt-salt-year', field: 'certification', target: {region: 'UK'}, proposed_value: 'PG-13', evidence: 'x'}), code('invalid_arguments'));
  unchanged(f, () => f.call('kinodex.corrections.submit', {title_id: 'tt-salt-year', field: 'runtime', target: {region: 'US'}, proposed_value: 120, evidence: 'x'}), code('invalid_arguments'));
  unchanged(f, () => f.call('kinodex.corrections.submit', {title_id: 'tt-salt-year', field: 'release_date', target: {region: 'US'}, proposed_value: '2025-05-09', evidence: 'x'}), code('no_change'));
  unchanged(f, () => f.call('kinodex.corrections.submit', {title_id: 'tt-salt-year', field: 'release_date', target: {region: 'US'}, proposed_value: '2025-13-01', evidence: 'x'}), code('invalid_date'));
  unchanged(f, () => f.call('kinodex.corrections.submit', {title_id: 'tt-salt-year', field: 'runtime', target: {edition_id: 'ed-salt-year-theatrical'}, proposed_value: 121, evidence: '   '}), code('invalid_arguments'));
});

// ---- T13 contracts across workflows -------------------------------------------------------
test('T13 events: each operation validates its payload; failures leave data and clock unchanged', () => {
  const f = fixture();
  const publish = ev('copper-sky-northcast-return'), clockBefore = f.ctx.virtual_now;
  unchanged(f, () => f.event(withPayload(publish, {title_id: 'tt-missing'})), code('target_not_found'));
  unchanged(f, () => f.event(withPayload(publish, {service_id: 'nowhere-tv'})), code('invalid_event'));
  unchanged(f, () => f.event(withPayload(publish, {service_id: 'plumvale', region: 'UK'})), /does not operate in region UK/);
  unchanged(f, () => f.event(withPayload(publish, {service_id: 'brightreel', type: 'rent'})), /need a positive price/);
  unchanged(f, () => f.event(withPayload(publish, {price: 3.99, currency: 'USD'})), /carry no price/);
  unchanged(f, () => f.event(withPayload(publish, {available_until: '2026-12-01T00:00:00-08:00'})), /precedes/);
  unchanged(f, () => f.event(withPayload(publish, {edition_id: 'ed-salt-year-extended'})), /edition of another title/);
  unchanged(f, () => f.event(withPayload(publish, {offer_id: seed.offers.find(o => o.title_id === 'tt-salt-year').offer_id})), /another title/);
  unchanged(f, () => f.event({event_id: 'end-missing', at: PT('2026-12-02', '00:00'), operation: 'offer.end', payload: {offer_id: 'of-missing'}}), code('target_not_found'));
  const ambervane = seed.offers.find(o => o.title_id === 'tt-ambervane' && o.service_id === 'northcast');
  unchanged(f, () => f.event({event_id: 'end-upcoming', at: PT('2026-12-02', '00:00'), operation: 'offer.end', payload: {offer_id: ambervane.offer_id}}), /not started/);
  const ended = seed.offers.find(o => o.available_until && o.available_until < '2026-06');
  unchanged(f, () => f.event({event_id: 'end-ended', at: PT('2026-12-02', '00:00'), operation: 'offer.end', payload: {offer_id: ended.offer_id}}), /already ended/);
  const update = payload => ({event_id: 'tu', at: PT('2026-12-02', '00:00'), operation: 'title.update', payload: {title_id: 'tt-harbor-lights', ...payload}});
  unchanged(f, () => f.event(update({title_id: 'tt-missing', release_dates: [{region: 'US', date: '2025-01-01'}]})), code('target_not_found'));
  unchanged(f, () => f.event(update({})), /at least one change/);
  unchanged(f, () => f.event(update({add_seasons: [{season_number: 2, name: 'Again', episodes: []}]})), /already has season 2/);
  unchanged(f, () => f.event(update({add_episodes: [{season_number: 4, episode_id: 'ep-x', number: 1, name: 'X', synopsis: 'X.', air_date: '2027-01-01', runtime_minutes: 50}]})), /outside the seasons/);
  unchanged(f, () => f.event(update({guide_version: {version: 3, reason: 'published_update', categories: {}}})), /numbered/);
  unchanged(f, () => f.event(update({guide_version: {version: 2, reason: 'published_update', categories: {violence: {severity: 'none'}}}})), /rated none cannot list items/);
  unchanged(f, () => f.event({...update({release_dates: [{region: 'US', date: '2026-11-20', certification: 'PG'}]}), payload: {title_id: 'tt-wrenfield-clock',
    release_dates: [{region: 'US', date: '2025-12-01'}, {region: 'UK', date: '2025-12-01'}, {region: 'CA', date: '2025-12-01'}]}}), /diary entries before/);
  assert.throws(() => f.event({...publish, operation: 'offer.retract'}), /Event schema/);
  assert.equal(f.ctx.virtual_now, clockBefore, 'Rejected events roll the clock back');
  // offer.end ends an offer at the event time.
  const brightreel = seed.offers.find(o => o.title_id === 'tt-fieldglass' && o.service_id === 'brightreel');
  f.event({event_id: 'fieldglass-early', at: PT('2026-12-01', '12:00'), operation: 'offer.end', payload: {offer_id: brightreel.offer_id}});
  assert.equal(f.data.offers.find(o => o.offer_id === brightreel.offer_id).available_until, PT('2026-12-01', '12:00'));
  assert.deepEqual(f.data.activity.map(a => [a.actor, a.action, a.event_id, a.replaced.available_until]), [['event', 'offer.end', 'fieldglass-early', brightreel.available_until]]);
});

test('T13 writes and events on history dated after the clock fail with clear App errors, never invalid_seed', () => {
  // A diary entry watched "today" but logged later that evening, with the clock in between: it is not in Kinodex yet.
  const last = seed.diary.at(-1);
  const early = fixture({virtual_now: last.watched_on + 'T12:00:00-08:00'});
  assert.ok(Date.parse(early.ctx.virtual_now) < Date.parse(last.logged_at));
  unchanged(early, () => early.call('kinodex.diary.update', {id: last.entry_id, patch: {rating: 3}}), code('not_found'));
  // A guide correction decided before the title's current guide version was published: the event's
  // consistency check uses every stored version, so the later seeded version makes it invalid_event.
  const g = seed.guides.find(x => x.versions.length > 1 && x.versions.at(-1).published_at.startsWith('2026-09'));
  const item = Object.values(g.versions.at(-1).categories).flatMap(x => x.items).find(i => !i.spoiler);
  const f = fixture({virtual_now: '2026-09-01T00:00:00Z'});
  f.call('kinodex.corrections.submit', {title_id: g.title_id, field: 'guide_item', target: {item_id: item.item_id}, proposed_value: {spoiler: true}, evidence: 'It gives away the ending.'});
  unchanged(f, () => f.event({event_id: 'early-approval', at: '2026-09-02T00:00:00Z', operation: 'correction.decision',
    payload: {correction_ref: {title_id: g.title_id, field: 'guide_item', target: {item_id: item.item_id}}, decision: 'approved'}}), code('invalid_event'));
});

// ---- Clock cutoff (added after plan approval) ---------------------------------------------
// Tools show only the records that exist at the clock (src/catalog.cjs visible); nothing is stored for it.
const catalogView = require('../src/catalog.cjs').visible;
const PDT = (date, time) => date + 'T' + time + ':00-07:00';
const after = (list, field, at) => list.filter(x => Date.parse(x[field]) > Date.parse(at));

test('Cutoff: at the fixture clock both shipped seeds show every stored record', () => {
  assert.deepEqual(catalogView(seed, clock), seed);
  assert.deepEqual(catalogView(inesSeed, clock), inesSeed);
});

test('Cutoff: Ines\'s seed loaded before its latest records shows only what existed at the clock', () => {
  // Ines's history runs to Nov 2026. On March 1, 2026 her later diary entries, her list (March 7), Harbor Lights
  // season 2 (added Sept 1) and the later guide versions and public reviews are not in Kinodex yet.
  const at = '2026-03-01T12:00:00Z', now = Date.parse(at);
  const f = fixture({seed: inesSeed, binding: inesBinding, virtual_now: at}), before = f.text;
  const shown = (list, field) => list.filter(x => Date.parse(x[field]) <= now);
  const diary = f.call('kinodex.diary.list', {limit: 500});
  assert.equal(diary.total, shown(inesSeed.diary, 'logged_at').length);
  assert.ok(diary.total > 0 && diary.total < inesSeed.diary.length);
  assert.ok(diary.entries.every(e => Date.parse(e.logged_at) <= now));
  assert.equal(f.call('kinodex.account.get').people[0].diary_entries, diary.total);
  assert.deepEqual(f.call('kinodex.lists.list').lists, []);
  assert.throws(() => f.call('kinodex.lists.get', {list_id: 'ls-01'}), code('not_found'));
  const reviews = f.call('kinodex.reviews.list', {source: 'public', limit: 200}).reviews;
  assert.equal(reviews.length, shown(inesSeed.public_reviews, 'posted_at').length);
  assert.ok(reviews.every(r => Date.parse(r.posted_at) <= now));
  const harbor = f.call('kinodex.titles.get', {title_id: 'tt-harbor-lights'}).title;
  assert.deepEqual([harbor.seasons.map(s => s.season_number), [...new Set(harbor.episodes.map(e => e.season_number))]], [[1], [1]]);
  assert.throws(() => f.call('kinodex.episodes.list', {title_id: 'tt-harbor-lights', season_number: 2}), code('not_found'));
  const g = inesSeed.guides.find(x => x.versions.length > 1 && Date.parse(x.versions[1].published_at) > now);
  assert.deepEqual(f.call('kinodex.guide.get', {title_id: g.title_id}).guide.versions.map(v => v.version), [1]);
  assert.throws(() => f.call('kinodex.guide.get', {title_id: g.title_id, version: 2}), code('not_found'));
  // Writes on later records are not_found and change nothing.
  const next = inesSeed.diary.find(e => Date.parse(e.logged_at) > now);
  unchanged(f, () => f.call('kinodex.diary.update', {id: next.entry_id, patch: {rating: 2}}), code('not_found'));
  unchanged(f, () => f.call('kinodex.diary.delete', {id: next.entry_id}), code('not_found'));
  unchanged(f, () => f.call('kinodex.lists.save', {id: 'ls-01', patch: {name: 'Renamed'}}), code('not_found'));
  unchanged(f, () => f.call('kinodex.diary.log', {title_id: 'tt-harbor-lights', episode_ids: ['ep-harbor-lights-s2e1'], watched_on: '2026-02-28'}), code('not_found'));
  assert.equal(f.text, before, 'Reads and rejected writes change nothing');
  // Time passing writes nothing; the later records appear because the clock reached them.
  f.advance(clock);
  assert.equal(f.text, before);
  assert.equal(f.call('kinodex.diary.list', {limit: 500}).total, inesSeed.diary.length);
  assert.equal(f.call('kinodex.lists.get', {list_id: 'ls-01'}).list.list_id, 'ls-01');
  assert.deepEqual(f.call('kinodex.titles.get', {title_id: 'tt-harbor-lights'}).title.seasons.map(s => s.season_number), [1, 2]);
  assert.equal(f.call('kinodex.guide.get', {title_id: g.title_id}).guide.current_version, g.versions.length);
  assert.deepEqual(f.call('kinodex.diary.update', {id: next.entry_id, patch: {rating: next.rating === 2 ? 3 : 2}}).changed_fields, ['rating']);
});

test('Cutoff: an early write changes only what exists at the clock; later seeded records stay byte-identical', () => {
  const at = PT('2026-01-20', '12:00');
  const f = fixture({virtual_now: at});
  const hidden = d => JSON.stringify([after(d.diary, 'logged_at', at), after(d.lists, 'created_at', at), after(d.alerts, 'created_at', at),
    after(d.corrections, 'submitted_at', at), after(d.notices, 'at', at), after(d.public_reviews, 'posted_at', at)]);
  const before = hidden(f.data);
  const logged = f.call('kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-01-18', rating: 3.5});
  const list = f.call('kinodex.lists.create', {name: 'January catch-up', title_ids: ['tt-salt-year']});
  assert.equal(hidden(f.data), before);
  assert.ok(!seed.diary.some(e => e.entry_id === logged.id) && !seed.lists.some(l => l.list_id === list.id), 'New IDs avoid hidden records');
  f.advance(clock);
  assert.equal(f.call('kinodex.diary.list', {limit: 500}).total, seed.diary.length + 1);
  assert.equal(f.call('kinodex.lists.list').lists.length, seed.lists.length + 1);
});

test('Cutoff: rules and corrections read as of the clock; a write or event on them replaces their later seeded history', () => {
  // On March 15, 2026 al-01 (created Feb 10) has not fired yet (Apr 14) and co-01 (submitted Mar 11) is undecided (Mar 20).
  const f = fixture({virtual_now: PDT('2026-03-15', '12:00')});
  const alerts = Object.fromEntries(f.call('kinodex.alerts.list').alerts.map(a => [a.alert_id, a]));
  assert.deepEqual(Object.keys(alerts).sort(), ['al-01', 'al-02']);
  assert.deepEqual([alerts['al-01'].status, alerts['al-01'].trigger, alerts['al-01'].updated_at], ['active', null, seed.alerts[0].created_at]);
  assert.deepEqual(f.call('kinodex.corrections.list').corrections.map(x => [x.correction_id, x.status, x.decisions.length, x.updated_at]),
    [['co-01', 'submitted', 0, seed.corrections[0].submitted_at]]);
  assert.deepEqual(f.call('kinodex.notices.list').notices, []);
  unchanged(f, () => f.call('kinodex.alerts.delete', {id: 'al-03'}), code('not_found'));
  unchanged(f, () => f.call('kinodex.corrections.withdraw', {id: 'co-03'}), code('not_found'));
  // The agent withdraws co-01 before its seeded approval: the approval and its notice are replaced.
  f.call('kinodex.corrections.withdraw', {id: 'co-01'});
  const co01 = f.data.corrections.find(x => x.correction_id === 'co-01');
  assert.deepEqual([co01.status, co01.decisions, co01.withdrawn_at], ['withdrawn', [], f.ctx.virtual_now]);
  assert.ok(!f.data.notices.some(n => n.correction_id === 'co-01'));
  // An event while al-01 is active fires it at the event time; the seeded April trigger and notice are replaced.
  const ruskford = seed.offers.find(o => o.offer_id === seed.alerts[0].trigger.offer.offer_id), at = PDT('2026-03-20', '09:00');
  f.event({event_id: 'ruskford-early', at, operation: 'offer.publish', payload: {...structuredClone(ruskford), available_from: at}});
  const al01 = f.data.alerts.find(a => a.alert_id === 'al-01');
  assert.deepEqual([al01.status, al01.trigger.at, al01.trigger.event_id], ['triggered', at, 'ruskford-early']);
  assert.deepEqual(f.data.notices.filter(n => n.alert_id === 'al-01').map(n => n.at), [at]);
  // Events reach only what exists at their time: co-03 is submitted on Nov 20.
  unchanged(f, () => f.event({event_id: 'co-03-early', at: PDT('2026-03-21', '09:00'), operation: 'correction.decision',
    payload: {correction_ref: {title_id: 'tt-pellmoor-junction', field: 'credit'}, decision: 'approved'}}), code('target_not_found'));
});

test('Cutoff: an event before a rule was created does not fire it', () => {
  const f = fixture({virtual_now: '2026-01-31T00:00:00Z'}), before = f.data.alerts.find(a => a.alert_id === 'al-01');
  const ruskford = seed.offers.find(o => o.offer_id === before.trigger.offer.offer_id), at = '2026-02-01T00:00:00Z';
  f.event({event_id: 'ruskford-before-rule', at, operation: 'offer.publish', payload: {...structuredClone(ruskford), available_from: at}});
  assert.deepEqual(f.data.alerts.find(a => a.alert_id === 'al-01'), before);
  assert.deepEqual(f.data.activity[0].effects, {alert_ids: [], notice_ids: []});
});

test('Cutoff: a new rule or correction replaces a seeded one on the same key that is created after the clock', () => {
  // al-04 (price_below rent on Marrow Bay) is created on Nov 2 and co-03 (Pellmoor Junction credit) on Nov 20.
  const f = fixture({virtual_now: PDT('2026-10-01', '12:00')});
  const rule = f.call('kinodex.alerts.create', {kind: 'price_below', title_id: 'tt-marrow-bay', offer_type: 'rent', threshold: 2.5});
  assert.deepEqual(f.data.alerts.filter(a => a.title_id === 'tt-marrow-bay').map(a => a.alert_id), [rule.id]);
  const co = f.call('kinodex.corrections.submit', {title_id: 'tt-pellmoor-junction', field: 'credit', target: {credit_id: 'cr-00083'},
    proposed_value: {character: 'Marta Kessling'}, evidence: 'The end credits spell it with a double s.'});
  assert.deepEqual(f.data.corrections.filter(x => x.title_id === 'tt-pellmoor-junction').map(x => x.correction_id), [co.id]);
  f.advance(clock);
  assert.deepEqual(f.call('kinodex.alerts.list', {title_id: 'tt-marrow-bay'}).alerts.map(a => a.alert_id), [rule.id]);
});

test('T13 the guide update for a watchlist title writes one guide notice; Lantern Hill (not on the watchlist) writes none', () => {
  const f = fixture();
  f.event(scenario);
  assert.equal(f.data.notices.length, seed.notices.length);
  f.event({event_id: 'copper-guide-v2', at: PT('2026-12-05', '08:00'), operation: 'title.update', payload: {title_id: 'tt-copper-sky',
    guide_version: {version: 2, reason: 'published_update', categories: {language: {severity: 'moderate', summary: 'Moderate swearing.'}}}}});
  assert.deepEqual(f.data.notices.slice(seed.notices.length).map(n => [n.kind, n.title_id, n.guide_version]), [['guide_updated', 'tt-copper-sky', 2]]);
});

test('T13 one activity row per committed write or event, none for reads or failures', () => {
  const f = fixture();
  f.call('kinodex.watchlist.get'); f.call('kinodex.offers.search', {on_my_services: true});
  unchanged(f, () => f.call('kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-11-26', rating: 3.3}), code('invalid_rating'));
  f.call('kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-11-26', rating: 3.5, request_id: 'r-log'});
  f.event(scenario);
  f.call('kinodex.lists.create', {name: 'Next', request_id: 'r-list'});
  assert.deepEqual(f.data.activity.map(a => [a.seq, a.actor, a.action, a.request_id, a.event_id]), [
    [1, 'agent', 'kinodex.diary.log', 'r-log', null], [2, 'event', 'title.update', null, 'lantern-hill-guide-v2'], [3, 'agent', 'kinodex.lists.create', 'r-list', null]]);
  assert.equal(f.data.activity[1].at, scenario.at);
  assert.equal(f.data.activity[1].replaced.guide_version, 1);
});

test('T13 seed validation rejects inconsistent catalogs and account state, and never compares dates with the clock', () => {
  const f = fixture();
  const reject = (mutate, pattern) => {const bad = f.data; mutate(bad); assert.throws(() => plugin.validateSeed(f.ctx, bad), pattern);};
  reject(d => d.titles.push(structuredClone(d.titles[0])), /Duplicate title/);
  reject(d => {d.episodes[0].season_number = 9;}, /outside the seasons/);
  reject(d => {d.episodes[0].title_id = 'tt-salt-year';}, /belongs to a film/);
  reject(d => {d.credits[0].person_id = 'pp-missing';}, /unknown title or person/);
  reject(d => {const o = d.offers.find(x => x.available_until); o.available_until = '2020-01-01T00:00:00Z';}, /precedes/);
  reject(d => {d.diary[0].watched_on = '1970-01-01';}, /earliest release/);
  reject(d => {d.diary[0].rating = 3.3;}, /half stars/);
  reject(d => {d.diary[0].watched_with = ['person-stranger'];}, /binding/);
  reject(d => {d.guides.pop();}, /exactly one parental guide/);
  reject(d => {d.alerts[0].trigger = null;}, /keeps its trigger/);
  reject(d => {d.corrections[2].target = {region: 'US'};}, /targets credit_id/);
  reject(d => {d.titles[0].releases[0].certification = 'X9';}, /not a certification/);
  reject(d => {d.account_id = 'kinodex-other';}, /binding/);
  reject(d => {d.corrections[1].proposed_value = 'X9';}, /Certifications in UK/);
  assert.equal(require('./schema-validator.cjs').compile(require('../schemas/seed.schema.json'), require('node:path').resolve(__dirname, '../schemas'))(
    {...f.data, notices: [{...f.data.notices[0], at: '2026-04-14T15:00:00'}]}), false, 'Timestamps need a UTC offset');
  // A run may start before the fixture's records; validation still passes, and future-dated writes fail clearly.
  const early = fixture({virtual_now: '2026-01-01T00:00:00Z'});
  unchanged(early, () => early.call('kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-11-26'}), /after today/);
});

test('T13 fixture checks from the construction plan: scale, references, diary range and Dana\'s rating style', () => {
  const d = seed, ines = inesSeed;
  assert.deepEqual([d.titles.filter(t => t.kind === 'film').length, d.titles.filter(t => t.kind === 'series').length], [160, 24]);
  assert.ok(d.episodes.length >= 290 && d.people.length === 900 && d.credits.length >= 2400 && d.offers.length >= 1150, 'About the proposal\'s scale');
  assert.equal(d.titles.filter(t => t.editions.length === 2).length, 40);
  assert.ok(d.guides.every(g => g.versions.length >= 1) && d.guides.filter(g => g.versions.length > 1).length === 60);
  assert.equal(d.services.length, 6);
  for (const account of [d, ines]) {
    assert.ok(account.diary.every(e => e.watched_on >= '2025-01-01' && e.watched_on <= clock.slice(0, 10)), 'Seeded diary between 2025-01-01 and the starting clock');
  }
  const ratings = d.diary.map(e => e.rating);
  assert.equal(ratings.length, 250);
  assert.equal(Math.round(ratings.reduce((s, x) => s + x, 0) / ratings.length * 10) / 10, 3.4);
  assert.ok(ratings.every(x => Number.isInteger(x * 2) && x < 5) && ratings.some(x => !Number.isInteger(x)), 'Half stars, never 5');
  assert.ok(ines.diary.every(e => Number.isInteger(e.rating)) && ines.diary.some(e => e.rating === 5), 'Ines rates in whole stars and gives 5s');
  // Item-2 suggestion: offer windows, guide versions, alerts and corrections from 2026 onward.
  assert.ok(d.offers.filter(o => o.available_from >= '2026-01-01').length > 300 && d.offers.some(o => o.available_until && o.available_until.startsWith('2026-0')));
  assert.ok(d.guides.flatMap(g => g.versions.slice(1)).every(v => v.published_at >= '2026-01-01'));
  assert.ok(d.alerts.every(a => a.created_at >= '2026-01-01') && d.corrections.every(c => c.submitted_at >= '2026-01-01'));
  // Offers never start before the title's release in their region; R / TV-MA titles rate a category moderate or higher.
  const release = new Map(d.titles.flatMap(t => t.releases.map(rl => [t.title_id + '|' + rl.region, rl.date])));
  assert.deepEqual(d.offers.filter(o => o.available_from.slice(0, 10) < release.get(o.title_id + '|' + o.region)).map(o => o.offer_id), []);
  const mature = d.titles.filter(t => ['R', 'NC-17', 'TV-MA'].includes(t.releases.find(rl => rl.region === 'US').certification));
  assert.ok(mature.length > 10 && mature.every(t => Object.values(d.guides.find(g => g.title_id === t.title_id).versions[0].categories)
    .some(cat => cat.severity === 'moderate' || cat.severity === 'severe')));
  const size = ['../fixtures/minimal.json', '../examples/task-data/seed.json'].map(file => require('node:fs').statSync(require('node:path').resolve(__dirname, file)).size);
  assert.ok(size.every(n => n < 1.5 * 1024 * 1024), 'Each seed stays well under the 2 MB MCP request limit: ' + size.join(', '));
});

test('T13 the second account shares the catalog but has its own region, services and right answers', () => {
  const catalog = x => ({services: x.services, titles: x.titles, episodes: x.episodes, people: x.people, credits: x.credits, guides: x.guides, offers: x.offers, public_reviews: x.public_reviews});
  assert.deepEqual(catalog(inesSeed), catalog(seed));
  const ines = fixture({seed: inesSeed, binding: inesBinding});
  assert.deepEqual([ines.data.account.region, ines.data.account.service_ids], ['UK', ['northcast', 'kettlewing']]);
  const ids = ines.call('kinodex.watchlist.get').items.map(i => i.title_id);
  const leaving = ines.call('kinodex.offers.search', {title_ids: ids, on_my_services: true}).results.filter(x => x.my_subscriptions.status === 'leaving_soon').map(x => x.name);
  assert.deepEqual(leaving, ['Fieldglass'], 'For Ines only Fieldglass leaves (Kettlewing UK); Copper Sky and Quiet Harbour stay on Northcast UK');
  const lantern = ines.call('kinodex.titles.get', {title_id: 'tt-lantern-hill'}).title;
  assert.equal(lantern.certification, 'PG');
  assert.equal(ines.call('kinodex.offers.for_title', {title_id: 'tt-lantern-hill'}).result.my_subscriptions.status, 'available');
  assert.throws(() => plugin.validateSeed(fixture().ctx, inesSeed), /binding/);
});

test('T13 packaging: dataset counts, policies and verifier inputs', () => {
  const pkg = require('../contribution/dataset.json'), task = require('../examples/task-data/dataset.json');
  assert.equal(pkg.expected_counts.records, plugin.records(seed).length);
  assert.equal(task.expected_counts.records, plugin.records(inesSeed).length);
  assert.deepEqual({...task, dataset_id: pkg.dataset_id}, pkg, 'Only the dataset ID differs');
  assert.deepEqual(pkg.sources[0].generation, {method: 'scripted', tool: 'dev/build-fixtures.cjs', tool_version: '1.0.0', seed: 20261201, parameters: {}});
  assert.match(require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../dev/build-fixtures.cjs'), 'utf8'), /const GENERATOR_SEED = 20261201;/);
  const policies = require('../fixtures/policies.json'), tools = require('../tools.json');
  assert.deepEqual(policies.scenario.allow, tools.filter(t => t.read_only).map(t => t.name));
  assert.equal(policies.sandbox.allow.length, 32);
  assert.ok(policies.scenario.allow.includes(require('./cases.json').read.name));
  assert.equal(require('../examples/task-data/policies.json').scenario.allow.length, 32);
  assert.ok(tools.every(t => t.name.startsWith('kinodex.')));
  const writes = tools.filter(t => !t.read_only);
  assert.equal(writes.length, 14);
  for (const t of writes) assert.ok(t.inputSchema.required.includes('expected_version') && t.inputSchema.required.includes('request_id'), t.name);
  // Writes on an existing object take {id, patch} so Core's constraints.ids / constraints.fields apply directly.
  const byId = writes.filter(t => t.inputSchema.properties.id).map(t => t.name);
  assert.deepEqual(byId, ['kinodex.diary.update', 'kinodex.diary.delete', 'kinodex.lists.save', 'kinodex.lists.delete', 'kinodex.alerts.update',
    'kinodex.alerts.delete', 'kinodex.corrections.amend', 'kinodex.corrections.withdraw']);
  for (const t of writes.filter(t => t.inputSchema.properties.id)) {
    const extra = Object.keys(t.inputSchema.properties).filter(p => !['id', 'expected_version', 'request_id'].includes(p));
    assert.ok(extra.every(p => p === 'patch' || p === 'expected_list_version'), t.name);
  }
});

test('T13 diagnostics carry IDs only and cannot change business results', () => {
  const on = fixture(), off = fixture({logging: false}), broken = fixture();
  broken.ctx.log = () => {throw Error('logger offline');};
  for (const f of [on, off, broken]) {f.event(scenario); f.call('kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-11-26', rating: 4});}
  assert.equal(on.text, off.text); assert.equal(broken.text, off.text);
  assert.deepEqual(on.logs.map(l => l.step), ['kinodex.event.title.update', 'kinodex.diary.log']);
  assert.equal(off.logs.length, 0);
  assert.doesNotMatch(JSON.stringify(on.logs), /Salt Year|Lantern|barn|review/);
});

// ---- Evaluation dataset, 2025-01-01 to 2026-12-31 (added after plan approval) ----------------
test('Evaluation dataset: counts and sha256 match the file; at four clocks nothing dated later is visible and reads change nothing', () => {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const text = fs.readFileSync(path.resolve(__dirname, '../data/evaluation/seed.json'), 'utf8'), evalSeed = JSON.parse(text);
  const meta = require('../data/evaluation/dataset.json'), evalBinding = require('../data/evaluation/binding.json');
  const evalClock = require('../data/evaluation/clock.json').initial_time, end = '2026-12-31T23:59:00-08:00';
  assert.equal(meta.expected_counts.records, plugin.records(evalSeed).length);
  assert.equal(meta.sources.find(s => s.source_id === 'generated').generation.parameters.outputs['seed.json'].sha256, crypto.createHash('sha256').update(text).digest('hex'));
  assert.ok(require('./schema-validator.cjs').compile(require('../schemas/dataset.schema.json'), path.resolve(__dirname, '../schemas'))(meta), 'dataset.json is a valid bundle dataset');
  assert.ok(Buffer.byteLength(JSON.stringify(evalSeed)) < 1.5e6, 'Compact seed under 1.5 MB, one env.load_seed request');
  assert.equal(evalClock, clock, 'The dataset clock is the fixture clock');
  // Dana's private records all exist by the dataset clock; only catalog records come later.
  const before = (list, field) => list.every(x => Date.parse(x[field]) <= Date.parse(evalClock));
  assert.ok(before(evalSeed.diary, 'logged_at') && before(evalSeed.alerts, 'created_at') && before(evalSeed.corrections, 'submitted_at') && before(evalSeed.notices, 'at') && before(evalSeed.lists, 'created_at'));
  // Fields that record when something happened; a later value must never reach the agent. updated_at is checked on
  // diary entries, rules and corrections; the watchlist, list and account stamps are current state (see README).
  const HAPPENED = new Set(['logged_at', 'posted_at', 'created_at', 'submitted_at', 'decided_at', 'amended_at', 'withdrawn_at', 'at']);
  function walk(value, now, where, extra = []) {
    if (Array.isArray(value)) {value.forEach(x => walk(x, now, where, extra)); return;}
    if (!value || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      if ((HAPPENED.has(k) || extra.includes(k)) && typeof v === 'string') assert.ok(Date.parse(v) <= now, where + ': ' + k + ' ' + v);
      else walk(v, now, where, extra);
    }
  }
  const series = evalSeed.titles.filter(t => t.kind === 'series'), versioned = evalSeed.guides.filter(g => g.versions.length > 1);
  for (const at of ['2025-03-15T12:00:00-07:00', '2025-12-31T23:59:00-08:00', evalClock, end]) {
    const now = Date.parse(at), shown = (list, field) => list.filter(x => Date.parse(x[field]) <= now);
    const data = JSON.parse(text), ctx = {app_id: 'kinodex', role: 'agent', virtual_now: at, binding: evalBinding};
    const call = (name, args = {}) => plugin.handleTool(ctx, data, name, args).result;
    const diary = call('kinodex.diary.list', {limit: 500});
    assert.equal(diary.total, shown(evalSeed.diary, 'logged_at').length, 'diary at ' + at);
    walk(diary, now, 'diary.list', ['updated_at']);
    assert.equal(call('kinodex.account.get').people[0].diary_entries, diary.total);
    const reviews = call('kinodex.reviews.list', {source: 'public', limit: 200}).reviews;
    assert.equal(reviews.length, Math.min(200, shown(evalSeed.public_reviews, 'posted_at').length));
    walk(reviews, now, 'reviews.list');
    const notices = call('kinodex.notices.list', {limit: 500}).notices;
    assert.equal(notices.length, shown(evalSeed.notices, 'at').length);
    walk(notices, now, 'notices.list');
    const alerts = call('kinodex.alerts.list').alerts;
    assert.equal(alerts.length, shown(evalSeed.alerts, 'created_at').length);
    walk(alerts, now, 'alerts.list', ['updated_at']);
    const corrections = call('kinodex.corrections.list').corrections;
    assert.equal(corrections.length, shown(evalSeed.corrections, 'submitted_at').length);
    walk(corrections, now, 'corrections.list', ['updated_at']);
    const lists = call('kinodex.lists.list').lists;
    assert.equal(lists.length, shown(evalSeed.lists, 'created_at').length);
    for (const l of lists) walk(call('kinodex.lists.get', {list_id: l.list_id}), now, 'lists.get');
    for (const t of series) {
      const view = call('kinodex.titles.get', {title_id: t.title_id}).title, seasons = shown(t.seasons, 'added_at').map(s => s.season_number);
      assert.deepEqual(view.seasons.map(s => s.season_number), seasons, t.title_id + ' seasons at ' + at);
      assert.ok(view.episodes.every(e => seasons.includes(e.season_number)));
    }
    for (const g of versioned) {
      const guide = call('kinodex.guide.get', {title_id: g.title_id}).guide;
      assert.equal(guide.current_version, Math.max(1, ...shown(g.versions, 'published_at').map(v => v.version)), g.title_id + ' guide at ' + at);
      assert.ok(guide.versions.every(v => v.version === 1 || Date.parse(v.published_at) <= now));
    }
    assert.equal(JSON.stringify(data), JSON.stringify(evalSeed), 'Reads change nothing');
  }
  // By the end of 2026 every record is visible.
  assert.deepEqual(catalogView(evalSeed, end), evalSeed);
  // At the dataset clock the December requests see what they see in the fixture.
  const answers = s => {
    const f = fixture({seed: s, logging: false}), ids = f.call('kinodex.watchlist.get').items.map(i => i.title_id);
    const named = ['tt-lantern-hill', 'tt-fieldglass', 'tt-copper-sky', 'tt-quiet-harbour', 'tt-salt-year', 'tt-wrenfield-clock', 'tt-pellmoor-junction', 'tt-ambervane', 'tt-marrow-bay', 'tt-harbor-lights', 'tt-pocket-comets'];
    return {leaving: f.call('kinodex.offers.search', {title_ids: ids, on_my_services: true}).results.map(x => [x.name, x.my_subscriptions]),
      titles: named.map(id => [f.call('kinodex.titles.get', {title_id: id}).title, f.call('kinodex.offers.for_title', {title_id: id}).result]),
      wrenfield: f.call('kinodex.diary.list', {title_id: 'tt-wrenfield-clock'}).entries, comets: f.call('kinodex.episodes.list', {title_id: 'tt-pocket-comets', hide_spoilers: true})};
  };
  assert.deepEqual(answers(evalSeed), answers(seed));
});
