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
const PAID_THROUGH = '2026-12-03T00:00:00-05:00', NEXT_PERIOD = '2027-01-03T00:00:00-05:00';
const ev = (event_id, at, operation, payload) => ({event_id, at, operation: 'lanternbox.' + operation, payload});
// A refusal carries its code and leaves business data unchanged.
function refuses(f, fn, code) { const before = JSON.stringify(f.data); assert.throws(fn, e => e.code === code, 'expected ' + code); assert.equal(JSON.stringify(f.data), before, code + ' left data unchanged'); }
const rejects = (f, event) => refuses(f, () => f.event(event), 'invalid_event');
const account = f => f.call('account.get').account;
const harbor = (f, id) => f.call('titles.get', {title_id: 'ttl-harbor-lights', id}).title;
const charge = (f, id, at, result, extra = {}) => f.event(ev(id, at, 'billing.charged', {period_start: f.data.account.paid_through, period_end: NEXT_PERIOD, amount_cents: 1599, result, ...extra}));
const EP6 = ev('ev-lb-211', '2026-11-20T03:00:00-05:00', 'catalog.episode_released', {title_id: 'ttl-harbor-lights', season: 2, episode: {playable_id: 'ep-harbor-s2e06', number: 6, name: 'Low Tide', runtime_seconds: 2880}});
const LEAVING = at => ev('ev-lb-212', at, 'catalog.leaving_set', {title_id: 'ttl-paper-kites', available_until: '2026-11-30T23:59:00-05:00'});
// The household after the two profiles that are not the adults' are deleted.
function twoProfiles() { const f = fixture(); f.call('profiles.delete', {id: 'prof-bisi'}); f.call('profiles.delete', {id: 'prof-timi'}); return f; }

test('T01 [W1] catalog search by text, kind, genre, rating and availability; a profile\'s ceiling; pagination', () => {
  const f = fixture(), before = f.data;
  assert.equal(f.call('catalog.search').total, 60);
  assert.deepEqual(f.call('catalog.search', {query: 'KITES '}).titles.map(t => t.title_id), ['ttl-paper-kites']);
  assert.deepEqual(f.call('catalog.search', {query: 'logbook'}).titles.map(t => t.title_id), ['ttl-harbor-lights'], 'the synopsis is searched');
  assert.deepEqual([f.call('catalog.search', {kind: 'film'}).total, f.call('catalog.search', {kind: 'series'}).total], [40, 20]);
  assert.equal(f.call('catalog.search', {genre: 'Documentary'}).total, 5);
  assert.equal(f.call('catalog.search', {maturity: '16+'}).total, 15);
  assert.deepEqual(['upcoming', 'available', 'leaving_soon', 'expired'].map(availability => f.call('catalog.search', {availability}).total), [2, 55, 1, 2]);
  assert.deepEqual(f.call('catalog.search', {availability: 'leaving_soon'}).titles.map(t => [t.title_id, t.available_until]), [['ttl-tin-roof', '2026-11-28T23:59:00-05:00']]);
  assert.deepEqual(f.call('catalog.search', {kind: 'series', genre: 'mystery', maturity: '13+'}).titles.map(t => t.name), ['Harbor Lights', 'The Greenhouse Mysteries', 'Wickerby Hall']);
  // As one profile, everything above its ceiling is left out.
  const kids = f.call('catalog.search', {id: 'prof-timi', limit: 100});
  assert.equal(kids.total, 19); assert.ok(kids.titles.every(t => ['all', '7+'].includes(t.maturity)));
  assert.equal(f.call('catalog.search', {id: 'prof-bisi'}).total, 51);
  assert.equal(f.call('catalog.search', {id: 'prof-timi', maturity: '16+'}).total, 0);
  const all = f.call('catalog.search', {limit: 100}).titles.map(t => t.name);
  assert.deepEqual(all, [...all].sort((a, b) => a.localeCompare(b)));
  const page = f.call('catalog.search', {limit: 10, offset: 55});
  assert.deepEqual([page.titles.length, page.total], [5, 60]);
  assert.deepEqual(page.titles.map(t => t.name), all.slice(55));
  const series = f.call('catalog.search', {query: 'harbor lights'}).titles[0];
  assert.deepEqual([series.kind, series.season_count, series.episode_count, series.runtime_seconds], ['series', 2, 13, null]);
  assert.throws(() => f.call('catalog.search', {id: 'prof-nobody'}), e => e.code === 'not_found' && /lanternbox\.profiles\.list/.test(e.message));
  assert.deepEqual(f.data, before);
});

test('T02 [W1] titles.get: seasons, episodes, per-profile progress and next_up', () => {
  const f = fixture(), before = f.data;
  const dele = harbor(f, 'prof-dele'), sana = harbor(f, 'prof-sana'), plain = f.call('titles.get', {title_id: 'ttl-harbor-lights'}).title;
  assert.deepEqual(dele.seasons.map(s => s.episodes.length), [8, 5]);
  assert.deepEqual(dele.next_up, {playable_id: 'ep-harbor-s2e04', season: 2, number: 4, name: 'Spring Tide'});
  assert.equal(sana.next_up, null, 'every released episode is completed');
  assert.deepEqual(dele.seasons[1].episodes.map(e => e.progress?.completed ?? null), [true, true, true, null, null]);
  assert.deepEqual(sana.seasons[1].episodes.map(e => e.progress.set_by), Array(5).fill('playback'));
  assert.deepEqual([plain.viewed_as, plain.next_up, plain.seasons[0].episodes[0].progress], [null, null, null]);
  assert.equal(dele.viewed_as, 'prof-dele');
  // A series with unreleased episodes: next_up never names one, and it appears when the clock reaches its release.
  const row = f.call('titles.get', {title_id: 'ttl-beacon-row', id: 'prof-bisi'}).title;
  assert.deepEqual(row.seasons[1].episodes.map(e => e.released), [true, true, false, false]);
  assert.equal(row.next_up.playable_id, 'ep-beacon-s1e01');
  for (const e of row.seasons.flatMap(s => s.episodes).filter(e => e.released)) f.call('progress.set', {id: 'prof-bisi', playable_id: e.playable_id, patch: {completed: true}});
  assert.equal(f.call('titles.get', {title_id: 'ttl-beacon-row', id: 'prof-bisi'}).title.next_up, null);
  const stored = f.data;
  f.advance('2026-11-20T02:59:59-05:00');
  assert.equal(f.call('titles.get', {title_id: 'ttl-beacon-row', id: 'prof-bisi'}).title.next_up, null);
  f.advance('2026-11-20T03:00:00-05:00');
  assert.equal(f.call('titles.get', {title_id: 'ttl-beacon-row', id: 'prof-bisi'}).title.next_up.playable_id, 'ep-beacon-s2e03');
  assert.deepEqual(f.data, stored, 'the release by time stored nothing');
  // A new episode of a fully watched series becomes next_up.
  f.event(EP6);
  assert.deepEqual(harbor(f, 'prof-sana').next_up, {playable_id: 'ep-harbor-s2e06', season: 2, number: 6, name: 'Low Tide'});
  assert.equal(harbor(f, 'prof-dele').next_up.playable_id, 'ep-harbor-s2e04');
  // A film is its own playable.
  const g = fixture(), film = g.call('titles.get', {title_id: 'ttl-clockmender-s', id: 'prof-bisi'}).title;
  assert.deepEqual([film.kind, film.seasons.length, film.next_up, film.progress.completed, film.progress.set_by], ['film', 0, null, true, 'playback']);
  refuses(g, () => g.call('titles.get', {title_id: 'ttl-salt-on', id: 'prof-timi'}), 'restricted');
  assert.equal(g.call('titles.get', {title_id: 'ttl-salt-on'}).title.maturity, '16+', 'without a profile the title is readable');
  assert.throws(() => g.call('titles.get', {title_id: 'ttl-nowhere'}), e => e.code === 'not_found' && /lanternbox\.catalog\.search/.test(e.message));
  assert.deepEqual(fixture().data, before);
});

test('T03 [W1] availability at each boundary: upcoming, available, leaving_soon at 14 days, expired', () => {
  const f = fixture(), state = id => f.call('catalog.search', {query: id}).titles[0].availability;
  const reed = f.data.titles.find(t => t.title_id === 'ttl-hollow-reed');
  assert.equal(reed.available_from, '2026-11-27T03:00:00-05:00');
  assert.equal(derive.availability(reed, '2026-11-27T02:59:59-05:00'), 'upcoming');
  assert.equal(derive.availability(reed, '2026-11-27T03:00:00-05:00'), 'available');
  assert.equal(state('Paper Kites'), 'available');
  f.event(LEAVING('2026-11-18T13:00:00-05:00'));
  const kites = f.data.titles.find(t => t.title_id === 'ttl-paper-kites');
  assert.equal(kites.available_until, '2026-11-30T23:59:00-05:00');
  // 14 x 24 hours before the end, to the second.
  assert.equal(derive.availability(kites, '2026-11-16T23:58:59-05:00'), 'available');
  assert.equal(derive.availability(kites, '2026-11-16T23:59:00-05:00'), 'leaving_soon');
  assert.equal(derive.availability(kites, '2026-11-30T23:58:59-05:00'), 'leaving_soon');
  assert.equal(derive.availability(kites, '2026-11-30T23:59:00-05:00'), 'expired');
  assert.equal(state('Paper Kites'), 'leaving_soon');
  // The clock alone moves the states; nothing is stored.
  const stored = f.data;
  f.advance('2026-11-27T03:00:00-05:00');
  assert.equal(state('Hollow Reed'), 'available'); assert.equal(f.call('catalog.search', {availability: 'upcoming'}).total, 1);
  f.advance('2026-11-30T23:58:59-05:00'); assert.equal(state('Paper Kites'), 'leaving_soon');
  f.advance('2026-11-30T23:59:00-05:00'); assert.equal(state('Paper Kites'), 'expired');
  assert.equal(state('Tin Roof Sonata'), 'expired');
  assert.deepEqual(f.data, stored);
  // An expired title stays on a list it was on, and is shown as expired.
  assert.deepEqual(f.call('watchlist.list', {id: 'prof-sana'}).watchlist.filter(w => w.title.availability === 'expired').map(w => w.title_id), ['ttl-paper-kites', 'ttl-tin-roof']);
  // One jump and several steps read the same.
  const g = fixture(); g.event(LEAVING('2026-11-18T13:00:00-05:00')); g.advance('2026-11-30T23:59:00-05:00');
  assert.deepEqual(g.call('catalog.search', {limit: 100}), f.call('catalog.search', {limit: 100}));
});

test('T04 [W1] account, plans, charges, devices and notifications; plans.list says whether a move is possible and why not', () => {
  const f = fixture(), before = f.data, a = f.call('account.get');
  assert.equal(a.now, CLOCK);
  assert.deepEqual({...a.account, last_charge: a.account.last_charge.charge_id}, {account_id: 'lanternbox-okoro', owner_profile_id: 'prof-sana', status: 'active', plan_id: 'standard', paid_through: PAID_THROUGH, pending: null,
    profile_count: 4, profile_limit: 4, suspends_at: null, next_charge: {period_start: PAID_THROUGH, plan_id: 'standard', amount_cents: 1599}, last_charge: 'chg-2026-11'});
  assert.deepEqual(f.call('plans.list').plans.map(p => [p.plan_id, p.max_profiles, p.price_cents, p.current, p.move, p.can_move_now, p.blockers, p.takes_effect]), [
    ['basic', 2, 999, false, 'downgrade', false, ['too_many_profiles: 4 profiles, 2 allowed'], null], ['standard', 4, 1599, true, 'none', false, ['same_plan'], null], ['premium', 5, 2299, false, 'upgrade', true, [], CLOCK]]);
  const charges = f.call('billing.history', {limit: 5, offset: 20});
  assert.deepEqual([charges.charges.length, charges.total], [4, 24]);
  assert.deepEqual(f.call('billing.history', {limit: 200}).charges.filter(c => c.result === 'failed').map(c => [c.charge_id, c.reason]), [['chg-2026-04-a', 'card_declined']]);
  assert.deepEqual(f.call('devices.list').devices.map(d => [d.device_id, d.status]), [['dev-livingroom-tv', 'signed_in'], ['dev-old-laptop', 'signed_out'], ['dev-sana-phone', 'signed_in'], ['dev-dele-laptop', 'signed_in'], ['dev-kids-tablet', 'signed_in']]);
  assert.equal(f.call('notifications.list').total, 17);
  assert.deepEqual(f.call('notifications.list', {since: '2026-11-01T00:00:00-05:00'}).notifications.map(n => n.notification_id), ['ntf-014', 'ntf-015', 'ntf-016', 'ntf-017']);
  assert.deepEqual(f.call('profiles.list').profiles.map(p => [p.profile_id, p.kind, p.maturity_ceiling, p.is_owner]), [['prof-sana', 'adult', '18+', true], ['prof-dele', 'adult', '18+', false], ['prof-timi', 'kids', '7+', false], ['prof-bisi', 'adult', '16+', false]]);
  assert.deepEqual(f.call('profiles.get', {id: 'prof-bisi'}).counts, {history_rows: 31, progress_rows: 9, watchlist_entries: 4});
  refuses(f, () => f.call('history.list', {id: 'prof-sana', from: '2026-11-10T00:00:00-05:00', to: '2026-11-01T00:00:00-05:00'}), 'invalid_window');
  assert.deepEqual(f.call('history.list', {id: 'prof-sana', from: '2026-11-07T00:00:00-05:00', to: '2026-11-18T00:00:00-05:00'}).history.map(h => [h.history_id, h.started_at]),
    [['hst-0362', '2026-11-14T20:55:00-05:00'], ['hst-0361', '2026-11-10T19:00:00-05:00'], ['hst-0360', '2026-11-07T20:45:00-05:00']]);
  assert.deepEqual([f.call('progress.list', {id: 'prof-sana'}).total, f.call('progress.list', {id: 'prof-sana', state: 'completed'}).total, f.call('progress.list', {id: 'prof-sana', state: 'in_progress'}).total], [122, 120, 2]);
  assert.deepEqual(f.data, before);
  // With two profiles the cheaper plan is open, and the answer says when it would take effect.
  const g = twoProfiles(), basic = g.call('plans.list').plans[0];
  assert.deepEqual([basic.can_move_now, basic.blockers, basic.takes_effect], [true, [], PAID_THROUGH]);
  g.call('plan.change', {id: 'basic'});
  assert.deepEqual(g.call('plans.list').plans.map(p => [p.plan_id, p.current, p.can_move_now]), [['basic', false, true], ['standard', true, true], ['premium', false, true]], 'choosing the current plan would clear the pending change');
  g.call('plan.cancel');
  assert.ok(g.call('plans.list').plans.every(p => !p.can_move_now && p.blockers.includes('pending_cancellation')));
  const late = fixture({at: '2026-12-10T00:00:00-05:00'});
  assert.ok(late.call('plans.list').plans.every(p => !p.can_move_now && p.blockers.includes('account_inactive')));
});

test('T05 [W2] watchlist add and remove; already_listed, not_listed, restricted, unavailable', () => {
  const f = fixture(), rows = f.data.activity.length;
  assert.deepEqual(f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'}), {id: 'prof-dele', title_id: 'ttl-paper-kites'});
  assert.deepEqual(f.call('watchlist.list', {id: 'prof-dele'}).watchlist.at(-1), {profile_id: 'prof-dele', title_id: 'ttl-paper-kites', added_at: CLOCK, title: f.call('catalog.search', {query: 'paper kites'}).titles[0]});
  refuses(f, () => f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'}), 'already_listed');
  refuses(f, () => f.call('watchlist.add', {id: 'prof-timi', title_id: 'ttl-salt-on'}), 'restricted');
  refuses(f, () => f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-borrowed-thunder'}), 'unavailable');
  refuses(f, () => f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-nowhere'}), 'not_found');
  refuses(f, () => f.call('watchlist.add', {id: 'prof-nobody', title_id: 'ttl-paper-kites'}), 'not_found');
  // A title that is not out yet can be saved for later.
  f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-hollow-reed'});
  assert.equal(f.call('watchlist.list', {id: 'prof-dele'}).watchlist.find(w => w.title_id === 'ttl-hollow-reed').title.availability, 'upcoming');
  assert.equal(f.call('watchlist.list', {id: 'prof-sana'}).watchlist.length, 8, 'another profile\'s list is untouched');
  f.call('watchlist.remove', {id: 'prof-dele', title_id: 'ttl-paper-kites'});
  assert.ok(!f.call('watchlist.list', {id: 'prof-dele'}).watchlist.some(w => w.title_id === 'ttl-paper-kites'));
  refuses(f, () => f.call('watchlist.remove', {id: 'prof-dele', title_id: 'ttl-paper-kites'}), 'not_listed');
  // An expired title can still be taken off a list.
  f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-tin-roof'}); f.advance('2026-11-29T00:00:00-05:00');
  refuses(f, () => f.call('watchlist.add', {id: 'prof-bisi', title_id: 'ttl-tin-roof'}), 'unavailable');
  f.call('watchlist.remove', {id: 'prof-dele', title_id: 'ttl-tin-roof'});
  assert.deepEqual(f.data.activity.slice(rows).map(r => [r.actor, r.action, r.object_id, r.profile_id, r.replaced]), [['agent', 'watchlist.add', 'ttl-paper-kites', 'prof-dele', null], ['agent', 'watchlist.add', 'ttl-hollow-reed', 'prof-dele', null],
    ['agent', 'watchlist.remove', 'ttl-paper-kites', 'prof-dele', {added_at: CLOCK}], ['agent', 'watchlist.add', 'ttl-tin-roof', 'prof-dele', null], ['agent', 'watchlist.remove', 'ttl-tin-roof', 'prof-dele', {added_at: CLOCK}]]);
});

test('T06 [W2] progress.set: a position, completed, back to the start; the replaced value; no history row', () => {
  const f = fixture(); f.event(EP6);
  const history = f.data.history.length, none = {position_seconds: null, completed: null, set_by: null, updated_at: null};
  assert.deepEqual(f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e04', patch: {completed: true}}), {id: 'prof-dele', playable_id: 'ep-harbor-s2e04', position_seconds: 2880, completed: true});
  f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e05', patch: {completed: true}});
  assert.equal(harbor(f, 'prof-dele').next_up.playable_id, 'ep-harbor-s2e06');
  const rows = f.data.progress.filter(r => r.profile_id === 'prof-dele' && ['ep-harbor-s2e04', 'ep-harbor-s2e05'].includes(r.playable_id));
  assert.deepEqual(rows.map(r => [r.set_by, r.completed, r.position_seconds, r.updated_at]), [['agent', true, 2880, EP6.at], ['agent', true, 2820, EP6.at]]);
  assert.deepEqual(f.data.activity.slice(-2).map(r => [r.action, r.object_id, r.profile_id, r.replaced]), [['progress.set', 'ep-harbor-s2e04', 'prof-dele', none], ['progress.set', 'ep-harbor-s2e05', 'prof-dele', none]]);
  assert.equal(f.data.history.length, history, 'marking is not watching: no history row');
  assert.equal(harbor(f, 'prof-sana').next_up.playable_id, 'ep-harbor-s2e06', 'Sana\'s progress is her own');
  // A position, then back to the start: each write records the value it replaced.
  assert.deepEqual(f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e06', patch: {position_seconds: 600}}), {id: 'prof-dele', playable_id: 'ep-harbor-s2e06', position_seconds: 600, completed: false});
  f.advance('2026-11-20T08:00:00-05:00');
  f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e06', patch: {position_seconds: 0}});
  assert.deepEqual(f.data.activity.at(-1).replaced, {position_seconds: 600, completed: false, set_by: 'agent', updated_at: EP6.at});
  assert.deepEqual(f.call('progress.list', {id: 'prof-dele', limit: 1}).progress[0], {profile_id: 'prof-dele', title_id: 'ttl-harbor-lights', title_name: 'Harbor Lights', playable_id: 'ep-harbor-s2e06', playable_name: 'Low Tide', season: 2, number: 6,
    runtime_seconds: 2880, position_seconds: 0, completed: false, set_by: 'agent', updated_at: '2026-11-20T08:00:00-05:00'});
  // The earlier value of a row that playback wrote is kept in the activity row, so it can be put back.
  const was = f.data.progress.find(r => r.profile_id === 'prof-sana' && r.playable_id === 'ep-harbor-s2e05');
  f.call('progress.set', {id: 'prof-sana', playable_id: 'ep-harbor-s2e05', patch: {position_seconds: 0}});
  assert.deepEqual(f.data.activity.at(-1).replaced, {position_seconds: 2790, completed: true, set_by: 'playback', updated_at: was.updated_at});
  f.call('progress.set', {id: 'prof-sana', playable_id: 'ep-harbor-s2e05', patch: {position_seconds: 2790, completed: true}});
  assert.deepEqual(harbor(f, 'prof-sana').next_up.playable_id, 'ep-harbor-s2e06');
  // A film: its playable ID is the title ID.
  assert.equal(f.call('progress.set', {id: 'prof-dele', playable_id: 'ttl-paper-kites', patch: {completed: true}}).position_seconds, f.data.titles.find(t => t.title_id === 'ttl-paper-kites').runtime_seconds);
  refuses(f, () => f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e06', patch: {position_seconds: 2881}}), 'invalid_position');
  refuses(f, () => f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e06', patch: {position_seconds: -1}}), 'invalid_position');
  refuses(f, () => f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-beacon-s2e04', patch: {completed: true}}), 'unavailable');
  refuses(f, () => f.call('progress.set', {id: 'prof-dele', playable_id: 'ttl-borrowed-thunder', patch: {completed: true}}), 'unavailable');
  refuses(f, () => f.call('progress.set', {id: 'prof-dele', playable_id: 'ttl-hollow-reed', patch: {completed: true}}), 'unavailable');
  refuses(f, () => f.call('progress.set', {id: 'prof-timi', playable_id: 'ttl-salt-on', patch: {completed: true}}), 'restricted');
  refuses(f, () => f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e06', patch: {}}), 'invalid_arguments');
  assert.throws(() => f.call('progress.set', {id: 'prof-dele', playable_id: 'ep-nowhere', patch: {completed: true}}), e => e.code === 'not_found' && /lanternbox\.titles\.get/.test(e.message));
  assert.equal(f.data.history.length, history);
});

test('T07 [W2] history.hide and unhide; default and include_hidden lists; progress is unaffected', () => {
  const f = fixture(), progress = JSON.stringify(f.data.progress);
  assert.deepEqual([f.call('history.list', {id: 'prof-sana'}).total, f.call('history.list', {id: 'prof-sana', include_hidden: true}).total], [140, 141], 'the fixture has one hidden row');
  assert.deepEqual(f.call('history.hide', {id: 'prof-sana', history_id: 'hst-0362', hidden: true}), {id: 'prof-sana', history_id: 'hst-0362', hidden: true});
  assert.ok(!f.call('history.list', {id: 'prof-sana', limit: 200}).history.some(h => h.history_id === 'hst-0362'));
  const row = f.call('history.list', {id: 'prof-sana', include_hidden: true, limit: 1}).history[0];
  assert.deepEqual([row.history_id, row.hidden, row.device_name, row.title_name, row.playable_name, row.season, row.number, row.seconds_watched], ['hst-0362', true, 'Living-room TV', 'Harbor Lights', 'Leading Lights', 2, 5, 2820]);
  assert.equal(JSON.stringify(f.data.progress), progress); assert.equal(harbor(f, 'prof-sana').next_up, null);
  assert.deepEqual(f.data.activity.at(-1).replaced, {hidden: false});
  f.call('history.hide', {id: 'prof-sana', history_id: 'hst-0362', hidden: false});
  assert.equal(f.call('history.list', {id: 'prof-sana'}).total, 140);
  assert.deepEqual(f.data.activity.at(-1).replaced, {hidden: true});
  // A row belongs to one profile: another profile's ID does not reach it.
  assert.throws(() => f.call('history.hide', {id: 'prof-dele', history_id: 'hst-0362', hidden: true}), e => e.code === 'not_found' && /lanternbox\.history\.list/.test(e.message));
  refuses(f, () => f.call('history.hide', {id: 'prof-sana', history_id: 'hst-9999', hidden: true}), 'not_found');
  assert.equal(f.call('history.list', {id: 'prof-dele'}).total, 115);
});

test('T08 [W2] writes while suspended or cancelled are refused; reads still work; past_due can still be changed', () => {
  const writes = f => [['watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'}], ['watchlist.remove', {id: 'prof-dele', title_id: 'ttl-harbor-lights'}],
    ['progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e04', patch: {completed: true}}], ['history.hide', {id: 'prof-sana', history_id: 'hst-0362', hidden: true}],
    ['profiles.create', {profile: {name: 'Ola', kind: 'kids'}}], ['profiles.update', {id: 'prof-dele', patch: {autoplay: true}}], ['profiles.delete', {id: 'prof-bisi'}], ['devices.sign_out', {id: 'dev-sana-phone'}],
    ['plan.change', {id: 'premium'}]].forEach(([name, args]) => refuses(f, () => f.call(name, args), 'account_inactive'));
  const reads = f => { for (const [name, args] of [['account.get'], ['plans.list'], ['billing.history'], ['profiles.list'], ['profiles.get', {id: 'prof-bisi'}], ['catalog.search'], ['titles.get', {title_id: 'ttl-harbor-lights', id: 'prof-dele'}],
    ['progress.list', {id: 'prof-dele'}], ['history.list', {id: 'prof-dele'}], ['watchlist.list', {id: 'prof-dele'}], ['devices.list'], ['notifications.list']]) f.call(name, args); };
  const f = fixture();
  f.advance('2026-12-03T00:00:00-05:00');
  assert.equal(account(f).status, 'past_due');
  f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'});
  f.advance('2026-12-10T00:00:00-05:00');
  assert.equal(account(f).status, 'suspended');
  assert.throws(() => f.call('watchlist.remove', {id: 'prof-dele', title_id: 'ttl-paper-kites'}), e => e.code === 'account_inactive' && e.message.includes('suspended at 2026-12-10T00:00:00-05:00'));
  writes(f); reads(f);
  const g = fixture(); g.call('plan.cancel'); g.advance(PAID_THROUGH);
  assert.equal(account(g).status, 'cancelled');
  writes(g); reads(g);
});

test('T09 [W3] profiles: create, update, delete with the removed counts; limit_reached, owner_profile, name_taken', () => {
  const f = fixture();
  assert.throws(() => f.call('profiles.create', {profile: {name: 'Ola', kind: 'kids'}}), e => e.code === 'limit_reached' && /allows 4 profiles/.test(e.message));
  // The deletion reports what it removed, in its result and in its activity row.
  const counts = f.call('profiles.get', {id: 'prof-bisi'}).counts, others = f.data.history.filter(h => h.profile_id !== 'prof-bisi').length;
  assert.deepEqual(f.call('profiles.delete', {id: 'prof-bisi'}), {id: 'prof-bisi', removed: {history_rows: 31, progress_rows: 9, watchlist_entries: 4}});
  assert.deepEqual(f.data.activity.at(-1).removed, counts);
  assert.deepEqual(f.data.activity.at(-1).replaced, {name: 'Auntie Bisi', kind: 'adult', maturity_ceiling: '16+', person_id: 'person-bisi'});
  const d = f.data;
  assert.ok(![...d.history, ...d.progress, ...d.watchlist, ...d.profiles].some(r => r.profile_id === 'prof-bisi'));
  assert.equal(d.history.length, others, 'nobody else\'s history was touched');
  refuses(f, () => f.call('profiles.get', {id: 'prof-bisi'}), 'not_found');
  refuses(f, () => f.call('profiles.delete', {id: 'prof-bisi'}), 'not_found');
  assert.deepEqual(f.call('profiles.create', {profile: {name: 'Ola', kind: 'kids'}}), {id: 'prof-r1'});
  assert.deepEqual(f.call('profiles.get', {id: 'prof-r1'}), {profile: {profile_id: 'prof-r1', name: 'Ola', maturity_ceiling: '7+', autoplay: true, notify_new_episodes: true, notify_leaving: true, kind: 'kids', person_id: null, created_at: CLOCK, is_owner: false},
    counts: {history_rows: 0, progress_rows: 0, watchlist_entries: 0}});
  refuses(f, () => f.call('profiles.create', {profile: {name: 'Kemi', kind: 'adult'}}), 'limit_reached');
  f.call('profiles.update', {id: 'prof-r1', patch: {name: ' Ola B ', autoplay: false}});
  assert.deepEqual(f.data.activity.at(-1).replaced, {name: 'Ola', autoplay: true});
  assert.deepEqual([f.call('profiles.get', {id: 'prof-r1'}).profile.name, f.call('profiles.get', {id: 'prof-r1'}).profile.autoplay], ['Ola B', false]);
  refuses(f, () => f.call('profiles.update', {id: 'prof-r1', patch: {name: ' SANA'}}), 'name_taken');
  f.call('profiles.update', {id: 'prof-r1', patch: {name: 'ola b'}});   // its own name in another case is not a clash
  refuses(f, () => f.call('profiles.update', {id: 'prof-r1', patch: {}}), 'invalid_arguments');
  refuses(f, () => f.call('profiles.delete', {id: 'prof-sana'}), 'owner_profile');
  f.call('profiles.delete', {id: 'prof-r1'});
  assert.deepEqual(f.data.activity.at(-1).removed, {history_rows: 0, progress_rows: 0, watchlist_entries: 0});
  refuses(f, () => f.call('profiles.create', {profile: {name: 'dele', kind: 'adult'}}), 'name_taken');
  // A profile can carry a person from the run binding, once.
  refuses(f, () => f.call('profiles.create', {profile: {name: 'Kemi', kind: 'adult', person_id: 'person-nobody'}}), 'invalid_arguments');
  refuses(f, () => f.call('profiles.create', {profile: {name: 'Kemi', kind: 'adult', person_id: 'person-dele'}}), 'invalid_arguments');
  assert.deepEqual(f.call('profiles.create', {profile: {name: 'Bisi', kind: 'adult', maturity_ceiling: '13+', person_id: 'person-bisi'}}), {id: 'prof-r2'});
  // Under a pending downgrade the limit is the plan the account is moving to.
  const g = twoProfiles();
  g.call('plan.change', {id: 'basic'});
  assert.deepEqual([account(g).plan_id, account(g).profile_limit, account(g).profile_count], ['standard', 2, 2]);
  assert.throws(() => g.call('profiles.create', {profile: {name: 'Ola', kind: 'kids'}}), e => e.code === 'limit_reached' && /allows 2 profiles \(the pending downgrade's limit\)/.test(e.message));
  g.call('plan.resume');
  assert.deepEqual(g.call('profiles.create', {profile: {name: 'Ola', kind: 'kids'}}), {id: 'prof-r1'});
});

test('T10 [W3] ceilings: invalid_ceiling for kids; lowering hides and raising restores, with no row deleted', () => {
  const f = fixture(), stored = () => { const d = f.data; return [d.history, d.progress, d.watchlist].map(rows => rows.filter(r => r.profile_id === 'prof-dele').length); };
  refuses(f, () => f.call('profiles.update', {id: 'prof-timi', patch: {maturity_ceiling: '13+'}}), 'invalid_ceiling');
  f.call('profiles.delete', {id: 'prof-bisi'});
  refuses(f, () => f.call('profiles.create', {profile: {name: 'Ola', kind: 'kids', maturity_ceiling: '13+'}}), 'invalid_ceiling');
  const lists = () => [f.call('watchlist.list', {id: 'prof-dele'}), f.call('history.list', {id: 'prof-dele', limit: 200}), f.call('progress.list', {id: 'prof-dele', limit: 200})];
  const before = lists(), rows = stored();
  assert.deepEqual(rows, [115, 98, 6]);
  f.call('profiles.update', {id: 'prof-dele', patch: {maturity_ceiling: '13+'}});
  const low = lists();
  assert.deepEqual(low[0].watchlist.map(w => w.title_id), ['ttl-harbor-lights', 'ttl-dandelion-courier']);
  assert.ok(low[1].total < 115 && low[2].total < 98);
  assert.ok([...low[1].history, ...low[2].progress].every(r => ['all', '7+', '13+'].includes(f.data.titles.find(t => t.title_id === r.title_id).maturity)));
  assert.deepEqual(stored(), rows, 'nothing was deleted');
  assert.equal(f.call('catalog.search', {id: 'prof-dele', maturity: '16+'}).total, 0);
  refuses(f, () => f.call('titles.get', {title_id: 'ttl-copper-wire', id: 'prof-dele'}), 'restricted');
  refuses(f, () => f.call('progress.set', {id: 'prof-dele', playable_id: 'ttl-copper-wire', patch: {completed: true}}), 'restricted');
  rejects(f, ev('ev-t10', '2026-11-19T21:00:00-05:00', 'playback.recorded', {profile_id: 'prof-dele', device_id: 'dev-dele-laptop', playable_id: 'ttl-copper-wire', started_at: '2026-11-19T19:00:00-05:00', position_seconds: 600, completed: false}));
  f.call('profiles.update', {id: 'prof-dele', patch: {maturity_ceiling: '18+'}});
  assert.deepEqual(lists(), before, 'everything returns when the ceiling is raised');
  // A kids profile can go lower, and comes back to 7+.
  f.call('profiles.update', {id: 'prof-timi', patch: {maturity_ceiling: 'all'}});
  assert.deepEqual(f.call('watchlist.list', {id: 'prof-timi'}).watchlist.map(w => w.title.maturity), ['all', 'all', 'all']);
  f.call('profiles.update', {id: 'prof-timi', patch: {maturity_ceiling: '7+'}});
  assert.equal(f.call('watchlist.list', {id: 'prof-timi'}).watchlist.length, 4);
  // A listed title that the ceiling now hides can still be taken off the list by its ID.
  f.call('profiles.update', {id: 'prof-dele', patch: {maturity_ceiling: '13+'}});
  f.call('watchlist.remove', {id: 'prof-dele', title_id: 'ttl-copper-wire'});
  assert.equal(f.data.watchlist.filter(w => w.profile_id === 'prof-dele').length, 5);
});

test('T11 [W3] devices: a new sign-in, a repeat sign-in, sign-out, invalid_state', () => {
  const f = fixture(), notes = f.data.notifications.length;
  f.event(ev('ev-lb-230', '2026-11-22T23:18:00-05:00', 'device.signed_in', {device_id: 'dev-tablet-02', name: 'Android tablet', kind: 'tablet'}));
  assert.deepEqual(f.call('devices.list').devices.at(-1), {device_id: 'dev-tablet-02', name: 'Android tablet', kind: 'tablet', status: 'signed_in', first_seen_at: '2026-11-22T23:18:00-05:00', last_used_at: '2026-11-22T23:18:00-05:00'});
  const note = f.data.notifications.at(-1);
  assert.deepEqual([f.data.notifications.length, note.notification_id, note.kind, note.device_id, note.text], [notes + 1, 'ntf-r1', 'device.new', 'dev-tablet-02', 'New sign-in from Android tablet.']);
  assert.deepEqual(f.call('devices.sign_out', {id: 'dev-tablet-02'}), {id: 'dev-tablet-02'});
  assert.equal(f.call('devices.list').devices.at(-1).status, 'signed_out');
  assert.equal(f.data.activity.at(-1).object_id, 'dev-tablet-02');
  refuses(f, () => f.call('devices.sign_out', {id: 'dev-tablet-02'}), 'invalid_state');
  refuses(f, () => f.call('devices.sign_out', {id: 'dev-old-laptop'}), 'invalid_state');
  assert.throws(() => f.call('devices.sign_out', {id: 'dev-nowhere'}), e => e.code === 'not_found' && /lanternbox\.devices\.list/.test(e.message));
  // Nothing can be watched on a signed-out device.
  const view = at => ev('ev-t11-' + at.slice(8, 10), at, 'playback.recorded', {profile_id: 'prof-sana', device_id: 'dev-tablet-02', playable_id: 'ttl-paper-kites', started_at: '2026-11-23T10:00:00-05:00', position_seconds: 900, completed: false});
  rejects(f, view('2026-11-23T10:15:00-05:00'));
  // The same device signing in again is not a new device: no second notification.
  f.event(ev('ev-t11-again', '2026-11-24T08:00:00-05:00', 'device.signed_in', {device_id: 'dev-tablet-02', name: 'Android tablet', kind: 'tablet'}));
  assert.deepEqual([f.call('devices.list').devices.at(-1).status, f.call('devices.list').devices.at(-1).first_seen_at, f.data.notifications.length], ['signed_in', '2026-11-22T23:18:00-05:00', notes + 1]);
  assert.deepEqual(f.data.activity.at(-1).replaced, {status: 'signed_out'});
  rejects(f, ev('ev-t11-clash', '2026-11-24T09:00:00-05:00', 'device.signed_in', {device_id: 'dev-tablet-02', name: 'Someone else\'s phone', kind: 'phone'}));
  rejects(f, ev('ev-t11-id', '2026-11-24T09:00:00-05:00', 'device.signed_in', {device_id: 'prof-sana', name: 'Phone', kind: 'phone'}));
});

test('T12 [W4] upgrade at once; downgrade pending, due by time at paid_through; one pending change; same_plan, too_many_profiles', () => {
  const four = fixture();
  assert.throws(() => four.call('plan.change', {id: 'basic'}), e => e.code === 'too_many_profiles' && /4 profiles and basic allows 2/.test(e.message));
  refuses(four, () => four.call('plan.change', {id: 'standard'}), 'same_plan');
  assert.throws(() => four.call('plan.change', {id: 'gold'}), e => e.code === 'not_found' && /lanternbox\.plans\.list/.test(e.message));
  const f = twoProfiles(), notes = f.data.notifications.length;
  // An upgrade takes effect at once and the next charge carries the new price.
  assert.deepEqual(f.call('plan.change', {id: 'premium'}), {id: 'premium', effect: 'upgraded', effective_at: CLOCK});
  assert.deepEqual([account(f).plan_id, account(f).pending, account(f).next_charge], ['premium', null, {period_start: PAID_THROUGH, plan_id: 'premium', amount_cents: 2299}]);
  // A downgrade is pending until paid_through; a second one replaces it: one change can be pending.
  assert.deepEqual(f.call('plan.change', {id: 'standard'}), {id: 'standard', effect: 'downgrade_pending', effective_at: PAID_THROUGH});
  assert.deepEqual(account(f).pending, {kind: 'downgrade', plan_id: 'standard', due_at: PAID_THROUGH, requested_at: CLOCK});
  assert.deepEqual([account(f).plan_id, account(f).profile_limit, account(f).next_charge.amount_cents], ['premium', 4, 1599]);
  f.call('plan.change', {id: 'basic'});
  assert.deepEqual([account(f).pending.plan_id, account(f).plan_id, account(f).profile_limit, account(f).next_charge.amount_cents], ['basic', 'premium', 2, 999]);
  assert.deepEqual(f.data.activity.at(-1).replaced, {plan_id: 'premium', pending: {kind: 'downgrade', plan_id: 'standard', due_at: PAID_THROUGH, requested_at: CLOCK}});
  // Choosing the current plan clears the pending change; with nothing pending it is same_plan.
  assert.deepEqual(f.call('plan.change', {id: 'premium'}), {id: 'premium', effect: 'pending_cleared', effective_at: CLOCK});
  assert.equal(account(f).pending, null);
  refuses(f, () => f.call('plan.change', {id: 'premium'}), 'same_plan');
  f.call('plan.change', {id: 'basic'});
  assert.equal(f.data.notifications.length, notes, 'the Agent\'s own plan changes write no notification');
  // The downgrade takes effect by time, exactly at paid_through, with no App event.
  const stored = f.data, g = fixture({seed: stored}), h = fixture({seed: stored}), k = fixture({seed: stored});
  f.advance('2026-12-02T23:59:59-05:00');
  assert.deepEqual([account(f).plan_id, account(f).status], ['premium', 'active']);
  f.advance(PAID_THROUGH);
  assert.deepEqual([account(f).plan_id, account(f).status, account(f).profile_limit, account(f).next_charge], ['basic', 'past_due', 2, {period_start: PAID_THROUGH, plan_id: 'basic', amount_cents: 999}]);
  assert.deepEqual(f.call('plans.list').plans.map(p => [p.plan_id, p.current, p.move]), [['basic', true, 'none'], ['standard', false, 'upgrade'], ['premium', false, 'upgrade']]);
  assert.deepEqual(f.data, stored, 'the clock stored nothing: no activity row, no notification');
  assert.deepEqual(derive.account(f.data, PAID_THROUGH).plan_id, 'basic', 'a grader derives the same plan from the snapshot and the clock');
  // The next paid charge stores it, at the cheaper plan's price, with one plan.changed notification.
  charge(f, 'chg-t12', '2026-12-03T04:10:00-05:00', 'paid', {amount_cents: 999});
  assert.deepEqual([f.data.account.plan_id, f.data.account.pending, f.data.account.paid_through, account(f).status], ['basic', null, NEXT_PERIOD, 'active']);
  assert.deepEqual([f.data.charges.at(-1).plan_id, f.data.charges.at(-1).expected_amount_cents], ['basic', 999]);
  assert.deepEqual(f.data.notifications.slice(notes).map(n => [n.kind, n.charge_id, n.text]), [['plan.changed', 'chg-r1', 'Your plan changed from Premium to Basic.']]);
  refuses(f, () => f.call('plan.change', {id: 'basic'}), 'same_plan');
  // After the due time, the plan in effect is the starting point of the next change.
  g.advance('2026-12-03T08:00:00-05:00');
  refuses(g, () => g.call('plan.change', {id: 'basic'}), 'same_plan');
  assert.deepEqual(g.call('plan.change', {id: 'standard'}), {id: 'standard', effect: 'upgraded', effective_at: '2026-12-03T08:00:00-05:00'});
  assert.deepEqual([g.data.account.plan_id, g.data.account.pending, g.data.activity.at(-1).replaced.plan_id], ['standard', null, 'basic']);
  // A charge taken before the due time is for the cheaper plan and leaves the change pending until its time.
  charge(h, 'chg-t12-early', '2026-12-02T22:00:00-05:00', 'paid', {amount_cents: 999});
  assert.deepEqual([h.data.account.plan_id, h.data.account.pending.plan_id, h.data.charges.at(-1).plan_id, account(h).plan_id, h.data.notifications.length], ['premium', 'basic', 'basic', 'premium', notes]);
  h.advance(PAID_THROUGH);
  assert.deepEqual([account(h).plan_id, account(h).status], ['basic', 'active']);
  // plan.resume undoes a downgrade that is still pending, and has nothing to undo once it is in effect.
  assert.deepEqual(k.call('plan.resume'), {id: 'lanternbox-okoro', cleared: 'downgrade'});
  k.call('plan.change', {id: 'basic'}); k.advance(PAID_THROUGH);
  refuses(k, () => k.call('plan.resume'), 'no_pending_change');
});

test('T13 [W4] cancel, resume, and cancelled at paid_through; invalid_state; no_pending_change', () => {
  const f = fixture(), notes = f.data.notifications.length;
  refuses(f, () => f.call('plan.resume'), 'no_pending_change');
  assert.deepEqual(f.call('plan.cancel'), {id: 'lanternbox-okoro', ends_at: PAID_THROUGH});
  assert.deepEqual([account(f).status, account(f).pending, account(f).next_charge], ['active', {kind: 'cancel', plan_id: null, due_at: PAID_THROUGH, requested_at: CLOCK}, null]);
  refuses(f, () => f.call('plan.cancel'), 'invalid_state');
  assert.throws(() => f.call('plan.change', {id: 'premium'}), e => e.code === 'invalid_state' && /lanternbox\.plan\.resume/.test(e.message));
  f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'});   // still active until paid_through
  assert.deepEqual(f.call('plan.resume'), {id: 'lanternbox-okoro', cleared: 'cancel'});
  assert.deepEqual([account(f).pending, account(f).next_charge.amount_cents], [null, 1599]);
  refuses(f, () => f.call('plan.resume'), 'no_pending_change');
  // Left in place, the account ends at paid_through by the clock alone.
  f.call('plan.cancel');
  const stored = f.data;
  f.advance('2026-12-02T23:59:59-05:00'); assert.equal(account(f).status, 'active');
  f.advance(PAID_THROUGH); assert.equal(account(f).status, 'cancelled');
  assert.deepEqual(f.data, stored);
  refuses(f, () => f.call('plan.resume'), 'invalid_state');
  refuses(f, () => f.call('plan.cancel'), 'invalid_state');
  refuses(f, () => f.call('plan.change', {id: 'premium'}), 'account_inactive');
  assert.equal(f.data.notifications.length, notes);
  // A paid charge brings an ended account back and clears the cancellation.
  charge(f, 'chg-t13', '2026-12-05T10:00:00-05:00', 'paid');
  assert.deepEqual([account(f).status, account(f).pending, account(f).paid_through], ['active', null, NEXT_PERIOD]);
  // A cancellation replaces a pending downgrade; undoing it does not bring the downgrade back.
  const g = twoProfiles();
  g.call('plan.change', {id: 'basic'}); g.call('plan.cancel');
  assert.deepEqual([account(g).pending.kind, account(g).profile_limit, g.data.activity.at(-1).replaced.pending.kind], ['cancel', 4, 'downgrade']);
  g.call('plan.resume');
  assert.deepEqual([account(g).pending, account(g).plan_id], [null, 'standard']);
  // Cancelling after the paid period has run out ends the account at once.
  const h = fixture({at: '2026-12-04T09:00:00-05:00'});
  assert.equal(account(h).status, 'past_due');
  assert.deepEqual(h.call('plan.cancel'), {id: 'lanternbox-okoro', ends_at: '2026-12-04T09:00:00-05:00'});
  assert.equal(account(h).status, 'cancelled');
});

test('T14 [W4] charges: paid, failed, past_due then suspended after 7 days, recovery; a charge for the wrong period', () => {
  const f = fixture(), notes = f.data.notifications.length, rows = f.data.charges.length;
  rejects(f, ev('ev-t14-wrong', '2026-12-03T04:10:00-05:00', 'billing.charged', {period_start: '2026-12-04T00:00:00-05:00', period_end: NEXT_PERIOD, amount_cents: 1599, result: 'paid'}));
  rejects(f, ev('ev-t14-empty', '2026-12-03T04:10:00-05:00', 'billing.charged', {period_start: PAID_THROUGH, period_end: PAID_THROUGH, amount_cents: 1599, result: 'paid'}));
  rejects(f, ev('ev-t14-dup', '2026-12-03T04:10:00-05:00', 'billing.charged', {charge_id: 'chg-2026-11', period_start: PAID_THROUGH, period_end: NEXT_PERIOD, amount_cents: 1599, result: 'paid'}));
  // The plan's example: the December charge fails.
  f.event(ev('ev-lb-220', '2026-12-03T04:10:00-05:00', 'billing.charged', {period_start: PAID_THROUGH, period_end: NEXT_PERIOD, amount_cents: 1599, result: 'failed', reason: 'card_declined'}));
  assert.deepEqual(f.data.charges.at(-1), {charge_id: 'chg-r1', period_start: PAID_THROUGH, period_end: NEXT_PERIOD, amount_cents: 1599, expected_amount_cents: 1599, plan_id: 'standard', result: 'failed', reason: 'card_declined', at: '2026-12-03T04:10:00-05:00'});
  assert.deepEqual(f.data.notifications.slice(notes).map(n => [n.kind, n.charge_id, n.text]), [['payment.failed', 'chg-r1', 'A payment of $15.99 could not be taken (card_declined).']]);
  assert.deepEqual([account(f).status, account(f).suspends_at, account(f).paid_through, account(f).last_charge.result], ['past_due', '2026-12-10T00:00:00-05:00', PAID_THROUGH, 'failed']);
  const stored = f.data;
  f.advance('2026-12-09T23:59:59-05:00'); assert.equal(account(f).status, 'past_due');
  f.advance('2026-12-10T00:00:00-05:00'); assert.deepEqual([account(f).status, account(f).suspends_at], ['suspended', null]);
  assert.deepEqual(f.data, stored, '7 days later, with no App event');
  refuses(f, () => f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'}), 'account_inactive');
  // A later paid charge for the same period returns the account to active.
  charge(f, 'chg-t14-paid', '2026-12-11T09:00:00-05:00', 'paid');
  assert.deepEqual([account(f).status, account(f).paid_through, f.data.charges.length, f.data.notifications.length], ['active', NEXT_PERIOD, rows + 2, notes + 1]);
  f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'});
  rejects(f, ev('ev-t14-again', '2026-12-12T09:00:00-05:00', 'billing.charged', {period_start: PAID_THROUGH, period_end: NEXT_PERIOD, amount_cents: 1599, result: 'paid'}));
  // With no charge at all the account reads past_due from paid_through and suspended 7 days later.
  const g = fixture(), before = g.data;
  g.advance('2026-12-02T23:59:59-05:00'); assert.equal(account(g).status, 'active');
  g.advance(PAID_THROUGH); assert.equal(account(g).status, 'past_due');
  g.advance('2026-12-10T00:00:00-05:00'); assert.equal(account(g).status, 'suspended');
  assert.deepEqual(g.data, before);
  assert.deepEqual(account(fixture({at: '2026-12-10T00:00:00-05:00'})), account(g), 'one jump and several steps read the same');
  // The amount is the task's; the App records beside it what the plan's price was.
  const h = fixture();
  charge(h, 'chg-t14-odd', '2026-12-03T04:10:00-05:00', 'paid', {amount_cents: 1299});
  assert.deepEqual([h.data.charges.at(-1).amount_cents, h.data.charges.at(-1).expected_amount_cents, h.data.notifications.length], [1299, 1599, notes]);
  assert.deepEqual(h.data.activity.at(-1).replaced, {plan_id: 'standard', paid_through: PAID_THROUGH, pending: null});
});

test('T15 [all] the six events: rejections, one notification per profile that qualifies, and events for a profile the Agent creates', () => {
  const f = fixture(), notes = () => f.data.notifications.length, n0 = notes();
  const view = (id, at, fields) => ev(id, at, 'playback.recorded', {device_id: 'dev-dele-laptop', playable_id: 'ep-harbor-s2e04', started_at: '2026-11-19T20:10:00-05:00', position_seconds: 2880, completed: true, ...fields});
  // playback.recorded: a history row, progress replaced, the device's last use; no notification.
  const history = f.data.history.length;
  f.event(view('ev-t15-view', '2026-11-19T21:00:00-05:00', {profile_id: 'prof-dele'}));
  assert.deepEqual(f.data.history.at(-1), {history_id: 'hst-r1', profile_id: 'prof-dele', device_id: 'dev-dele-laptop', playable_id: 'ep-harbor-s2e04', title_id: 'ttl-harbor-lights', started_at: '2026-11-19T20:10:00-05:00', seconds_watched: 2880, hidden: false,
    recorded_at: '2026-11-19T21:00:00-05:00'});
  assert.deepEqual(f.data.progress.find(r => r.profile_id === 'prof-dele' && r.playable_id === 'ep-harbor-s2e04'), {profile_id: 'prof-dele', playable_id: 'ep-harbor-s2e04', title_id: 'ttl-harbor-lights', position_seconds: 2880, completed: true, set_by: 'playback',
    updated_at: '2026-11-19T21:00:00-05:00'});
  assert.equal(f.data.devices.find(d => d.device_id === 'dev-dele-laptop').last_used_at, '2026-11-19T21:00:00-05:00');
  assert.deepEqual([harbor(f, 'prof-dele').next_up.playable_id, notes()], ['ep-harbor-s2e05', n0]);
  assert.deepEqual([f.data.activity.at(-1).actor, f.data.activity.at(-1).action, f.data.activity.at(-1).event_id, f.data.activity.at(-1).object_id, f.data.activity.at(-1).replaced], ['event', 'playback.recorded', 'ev-t15-view', 'hst-r1', null]);
  const at = '2026-11-19T22:00:00-05:00';
  for (const [n, fields] of [{profile_id: 'prof-nobody'}, {profile_name: 'Nobody'}, {profile_id: 'prof-dele', profile_name: 'Dele'}, {}, {profile_id: 'prof-dele', device_id: 'dev-nowhere'}, {profile_id: 'prof-dele', device_id: 'dev-old-laptop'},
    {profile_id: 'prof-dele', playable_id: 'ep-nowhere'}, {profile_id: 'prof-timi', playable_id: 'ttl-salt-on', position_seconds: 60}, {profile_id: 'prof-dele', playable_id: 'ttl-borrowed-thunder', position_seconds: 60},
    {profile_id: 'prof-dele', playable_id: 'ep-beacon-s2e03', position_seconds: 60}, {profile_id: 'prof-dele', playable_id: 'ttl-hollow-reed', position_seconds: 60}, {profile_id: 'prof-dele', position_seconds: 2881},
    {profile_id: 'prof-dele', started_at: '2026-11-19T22:00:01-05:00'}, {profile_id: 'prof-dele', started_at: '2024-12-31T20:00:00-05:00'},
    {profile_id: 'prof-dele', seconds_watched: 2881}].entries()) rejects(f, view('ev-t15-bad-' + n, at, fields));
  assert.equal(f.data.history.length, history + 1);
  // catalog.title_added (the plan's example, at a time after the fixture clock): upcoming, no notification.
  const glass = {title_id: 'ttl-glass-orchard', kind: 'film', name: 'The Glass Orchard', maturity: '13+', genres: ['drama'], runtime_seconds: 6480, available_from: '2026-11-25T03:00:00-05:00', available_until: null};
  f.event(ev('ev-lb-210', at, 'catalog.title_added', {title: glass}));
  assert.deepEqual([f.call('catalog.search', {query: 'glass orchard'}).titles[0].availability, f.call('catalog.search').total, notes()], ['upcoming', 61, n0]);
  rejects(f, ev('ev-t15-dup', at, 'catalog.title_added', {title: glass}));
  rejects(f, ev('ev-t15-shape', at, 'catalog.title_added', {title: {...glass, title_id: 'ttl-other', seasons: [{number: 1, episodes: []}]}}));
  rejects(f, ev('ev-t15-ends', at, 'catalog.title_added', {title: {...glass, title_id: 'ttl-other', available_until: '2026-11-25T03:00:00-05:00'}}));
  rejects(f, ev('ev-t15-ep', at, 'catalog.title_added', {title: {title_id: 'ttl-other', kind: 'series', name: 'Other', maturity: 'all', genres: ['family'], available_from: at, seasons: [{number: 1, episodes: [
    {playable_id: 'ep-harbor-s2e05', number: 1, name: 'Clash', runtime_seconds: 600, released_at: at}]}]}}));
  // catalog.episode_released: one notification for each profile that has the series listed or in progress and has the setting on.
  f.event(EP6);
  assert.deepEqual(f.data.notifications.slice(n0).map(n => [n.kind, n.profile_id, n.title_id, n.playable_id, n.text]), [['episode.released', 'prof-sana', 'ttl-harbor-lights', 'ep-harbor-s2e06', 'New episode of Harbor Lights: season 2, episode 6, "Low Tide".'],
    ['episode.released', 'prof-dele', 'ttl-harbor-lights', 'ep-harbor-s2e06', 'New episode of Harbor Lights: season 2, episode 6, "Low Tide".']]);
  assert.equal(f.data.titles.find(t => t.title_id === 'ttl-harbor-lights').seasons[1].episodes[5].released_at, EP6.at);
  const later = '2026-11-21T03:00:00-05:00', episode = {playable_id: 'ep-harbor-s2e07', number: 7, name: 'Slack Tide', runtime_seconds: 2700};
  rejects(f, ev('ev-t15-e1', later, 'catalog.episode_released', {title_id: 'ttl-harbor-lights', season: 2, episode: {...episode, playable_id: 'ep-harbor-s2e06'}}));
  rejects(f, ev('ev-t15-e2', later, 'catalog.episode_released', {title_id: 'ttl-harbor-lights', season: 2, episode: {...episode, number: 6}}));
  rejects(f, ev('ev-t15-e3', later, 'catalog.episode_released', {title_id: 'ttl-paper-kites', season: 1, episode}));
  rejects(f, ev('ev-t15-e4', later, 'catalog.episode_released', {title_id: 'ttl-nowhere', season: 1, episode}));
  // With Dele's setting off only Sana is told; a series followed by progress alone counts; a new season is created by its first episode.
  f.call('profiles.update', {id: 'prof-dele', patch: {notify_new_episodes: false}});
  let n1 = notes();
  f.event(ev('ev-t15-e5', later, 'catalog.episode_released', {title_id: 'ttl-harbor-lights', season: 2, episode}));
  assert.deepEqual(f.data.notifications.slice(n1).map(n => n.profile_id), ['prof-sana']);
  n1 = notes();
  f.event(ev('ev-t15-e6', later, 'catalog.episode_released', {title_id: 'ttl-greenhouse-mysteries', season: 3, episode: {playable_id: 'ep-greenhouse-s3e01', number: 1, name: 'Under Glass', runtime_seconds: 2400}}));
  assert.deepEqual([f.data.notifications.slice(n1).map(n => n.profile_id), f.data.titles.find(t => t.title_id === 'ttl-greenhouse-mysteries').seasons.map(s => s.episodes.length)], [['prof-sana'], [6, 6, 1]]);
  n1 = notes();
  f.event(ev('ev-t15-e7', later, 'catalog.episode_released', {title_id: 'ttl-underfloor', season: 1, episode: {playable_id: 'ep-underfloor-s1e07', number: 7, name: 'Crawl Space', runtime_seconds: 2400}}));
  assert.equal(notes(), n1, 'nobody follows it: no notification');
  // catalog.leaving_set: Sana has the film listed with the setting on; Dele has the setting off.
  f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'});
  n1 = notes();
  f.event(LEAVING(later));
  assert.deepEqual(f.data.notifications.slice(n1).map(n => [n.kind, n.profile_id, n.title_id, n.text]), [['title.leaving', 'prof-sana', 'ttl-paper-kites', 'Paper Kites leaves Lanternbox on November 30, 2026 at 11:59 PM.']]);
  assert.deepEqual(f.data.activity.at(-1).replaced, {available_until: null});
  rejects(f, ev('ev-t15-l1', later, 'catalog.leaving_set', {title_id: 'ttl-paper-kites', available_until: later}));
  rejects(f, ev('ev-t15-l2', later, 'catalog.leaving_set', {title_id: 'ttl-nowhere', available_until: '2026-12-30T23:59:00-05:00'}));
  // None of the Agent's own writes above wrote a notification, and time alone writes none.
  const agentRows = f.data.activity.filter(r => r.actor === 'agent' && Date.parse(r.at) >= Date.parse(CLOCK)).length;
  assert.equal(agentRows, 2);
  assert.equal(notes(), n0 + 5);
  f.advance('2026-12-01T00:00:00-05:00'); assert.equal(notes(), n0 + 5);

  // A profile the Agent creates during the run: a prewritten event reaches it by its name.
  const g = fixture();
  const ola = (id, at2, name) => ev(id, at2, 'playback.recorded', {profile_name: name, device_id: 'dev-kids-tablet', playable_id: 'ttl-otter-club', started_at: '2026-11-21T16:00:00-05:00', position_seconds: 1200, completed: false});
  rejects(g, ola('ev-ola-early', '2026-11-21T16:20:00-05:00', 'Ola'));   // control: the Agent has not created it
  g.call('profiles.delete', {id: 'prof-bisi'});
  const created = g.call('profiles.create', {profile: {name: 'Ola', kind: 'kids'}}).id;
  g.event(ola('ev-ola', '2026-11-21T16:20:00-05:00', ' ola '));
  assert.deepEqual([g.data.history.at(-1).profile_id, g.data.history.at(-1).history_id, g.data.activity.at(-1).profile_id], [created, 'hst-r1', created]);
  assert.deepEqual(g.call('profiles.get', {id: created}).counts, {history_rows: 1, progress_rows: 1, watchlist_entries: 0});
  assert.equal(g.call('history.list', {id: created}).history[0].seconds_watched, 1200);
  // The ID works too, and a kids profile cannot be shown a 16+ film whatever names it.
  g.event(ev('ev-ola-id', '2026-11-22T16:30:00-05:00', 'playback.recorded', {profile_id: created, device_id: 'dev-kids-tablet', playable_id: 'ttl-otter-club', started_at: '2026-11-22T16:00:00-05:00', position_seconds: 3000, completed: false, seconds_watched: 1500}));
  assert.deepEqual([g.data.history.at(-1).seconds_watched, g.data.activity.at(-1).replaced.position_seconds], [1500, 1200]);
  rejects(g, ev('ev-ola-16', '2026-11-22T17:30:00-05:00', 'playback.recorded', {profile_name: 'Ola', device_id: 'dev-kids-tablet', playable_id: 'ttl-salt-on', started_at: '2026-11-22T17:00:00-05:00', position_seconds: 60, completed: false}));
  // The name is the one the profile has when the event arrives.
  g.call('profiles.update', {id: created, patch: {name: 'Ola B'}});
  rejects(g, ola('ev-ola-old-name', '2026-11-23T16:20:00-05:00', 'Ola'));
  // Nothing can be watched on a suspended account.
  g.advance('2026-12-10T00:00:00-05:00');
  rejects(g, ev('ev-ola-late', '2026-12-10T17:30:00-05:00', 'playback.recorded', {profile_id: created, device_id: 'dev-kids-tablet', playable_id: 'ttl-otter-club', started_at: '2026-12-10T17:00:00-05:00', position_seconds: 60, completed: false}));
});

test('T16 [all] seed validation, the bound account, and one activity row per committed write or applied event', () => {
  // Core's side of T16 (replays, conflicts, stale versions, Agent against Infra authority, reset, and a policy that
  // allows writes on one profile only) runs over real MCP in tests/mcp.integration.cjs.
  const invalid = (change, at = CLOCK, bind = binding()) => { const s = seed(); change(s); assert.throws(() => plugin.validateSeed({app_id: 'lanternbox', virtual_now: at, binding: bind}, s), e => e.code === 'invalid_seed', String(change)); };
  plugin.validateSeed({app_id: 'lanternbox', virtual_now: CLOCK, binding: binding()}, seed());
  invalid(s => { s.account_id = 'unbound-account'; });
  invalid(() => {}, CLOCK, {...binding(), accounts: [{app_id: 'notes', account_id: 'lanternbox-okoro', owner_person_id: 'person-sana'}]});
  // The Agent acts as the account holder: the owner profile cannot belong to another person.
  invalid(() => {}, CLOCK, {...binding(), accounts: [{app_id: 'lanternbox', account_id: 'lanternbox-okoro', owner_person_id: 'person-dele'}]});
  invalid(s => { s.account.owner_profile_id = 'prof-nobody'; });
  invalid(s => { s.account.plan_id = 'gold'; });
  invalid(s => { s.profiles.push({...s.profiles[1], profile_id: 'prof-five', name: 'Five', person_id: null}); });   // more profiles than the plan allows
  invalid(s => { s.profiles[1].profile_id = 'prof-sana'; });
  invalid(s => { s.profiles[1].name = 'SANA'; });
  invalid(s => { s.profiles[1].person_id = 'person-sana'; });
  invalid(s => { s.profiles[1].person_id = 'person-nobody'; });
  invalid(s => { s.profiles[2].maturity_ceiling = '13+'; });
  invalid(s => { s.titles[1].title_id = s.titles[0].title_id; });
  invalid(s => { s.titles[0].seasons = [{number: 1, episodes: []}]; });
  invalid(s => { s.titles[0].available_until = s.titles[0].available_from; });
  invalid(s => { const t = s.titles.find(t => t.kind === 'series'); t.seasons[0].episodes[1].playable_id = t.seasons[0].episodes[0].playable_id; });
  invalid(s => { s.progress[0].position_seconds = 999999; });
  invalid(s => { s.progress.push({...s.progress[0]}); });
  invalid(s => { s.progress[0].playable_id = 'ep-nowhere'; });
  invalid(s => { s.history[0].device_id = 'dev-nowhere'; });
  invalid(s => { s.history[0].profile_id = 'prof-nobody'; });
  invalid(s => { s.history[1].history_id = s.history[0].history_id; });
  invalid(s => { s.watchlist.push({...s.watchlist[0]}); });
  invalid(s => { s.watchlist[0].title_id = 'ttl-nowhere'; });
  invalid(s => { s.charges[1].charge_id = s.charges[0].charge_id; });
  invalid(s => { s.activity[5].seq = 99; });
  invalid(s => { s.account.pending = {kind: 'downgrade', plan_id: 'premium', due_at: s.account.paid_through, requested_at: '2026-11-17T10:00:00-05:00'}; });
  invalid(s => { s.account.pending = {kind: 'downgrade', plan_id: 'basic', due_at: s.account.paid_through, requested_at: '2026-11-17T10:00:00-05:00'}; });   // four profiles, two allowed
  // Times: an offset is required, nothing the household did is before 2025-01-01 or after the current time.
  invalid(s => { s.history[0].started_at = '2025-01-05T19:00:00'; });
  invalid(s => { s.account.paid_through = '2026-12-03T00:00:00'; });
  invalid(s => { s.history[0].started_at = '2024-12-31T23:59:59Z'; });
  invalid(s => { s.profiles[0].created_at = '2024-06-01T10:00:00-04:00'; });
  invalid(() => {}, '2026-11-01T00:00:00-05:00');
  // A catalog date may be older or later: a film released in 2019 and one arriving next year are valid.
  const old = seed(); old.titles[0].available_from = '2019-03-01T03:00:00-05:00'; old.titles[1].available_from = '2027-03-01T03:00:00-05:00';
  plugin.validateSeed({app_id: 'lanternbox', virtual_now: CLOCK, binding: binding()}, old);
  // A task's own household loads through the same schema: an account that is already past due, with a pending downgrade.
  const own = seed();
  own.profiles = own.profiles.slice(0, 2); for (const k of ['progress', 'history', 'watchlist']) own[k] = own[k].filter(r => ['prof-sana', 'prof-dele'].includes(r.profile_id));
  own.account.pending = {kind: 'downgrade', plan_id: 'basic', due_at: PAID_THROUGH, requested_at: '2026-11-17T10:00:00-05:00'};
  const late = fixture({seed: own, at: '2026-12-05T09:00:00-05:00'});
  assert.deepEqual([account(late).status, account(late).plan_id, account(late).suspends_at], ['past_due', 'basic', '2026-12-10T00:00:00-05:00']);

  // One activity row for each committed write and each applied event; none for a refused call, a rejected event, a read or the clock.
  const f = fixture(), rows = () => f.data.activity.length, r0 = rows();
  f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'});
  assert.equal(rows(), r0 + 1);
  assert.deepEqual(f.data.activity.at(-1), {seq: r0 + 1, at: CLOCK, actor: 'agent', action: 'watchlist.add', object_id: 'ttl-paper-kites', profile_id: 'prof-dele', request_id: 'local-1', event_id: null, replaced: null, removed: null});
  refuses(f, () => f.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'}), 'already_listed');
  f.call('catalog.search'); f.advance('2026-11-19T00:00:00-05:00');
  assert.equal(rows(), r0 + 1);
  f.event(EP6);
  assert.deepEqual([rows(), f.data.activity.at(-1).actor, f.data.activity.at(-1).action, f.data.activity.at(-1).event_id, f.data.activity.at(-1).object_id], [r0 + 2, 'event', 'catalog.episode_released', 'ev-lb-211', 'ep-harbor-s2e06']);
  rejects(f, EP6);
  assert.equal(rows(), r0 + 2);
  // Stored state and the published derivation give what the read tools return.
  const now = f.ctx.virtual_now, d = f.data, a = account(f), view = derive.account(d, now);
  assert.deepEqual([view.status, view.plan_id, view.profile_limit, view.suspends_at, view.next_charge], [a.status, a.plan_id, a.profile_limit, a.suspends_at, a.next_charge]);
  for (const t of f.call('catalog.search', {limit: 100}).titles) assert.equal(derive.availability(d.titles.find(x => x.title_id === t.title_id), now), t.availability);
  assert.deepEqual(derive.nextUp(d, d.titles.find(t => t.title_id === 'ttl-harbor-lights'), 'prof-dele', now), harbor(f, 'prof-dele').next_up);
  // Diagnostics, when the host asks for them, never change a result.
  const logged = fixture({logging: true});
  logged.call('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'});
  assert.deepEqual(logged.logs.map(l => l.step), ['lanternbox.watchlist.add']);
});

test('fixtures: the generated history is consistent, dated from 2025 and matches the plan\'s household', () => {
  const s = seed(), now = Date.parse(CLOCK), count = (rows, id) => rows.filter(r => r.profile_id === id).length;
  const playables = new Map(s.titles.flatMap(t => derive.playables(t).map(p => [p.playable_id, {title: t, playable: p}])));
  assert.deepEqual([s.plans.length, s.profiles.length, s.titles.filter(t => t.kind === 'film').length, s.titles.filter(t => t.kind === 'series').length, s.devices.length, s.watchlist.length], [3, 4, 40, 20, 5, 22]);
  assert.equal(s.titles.filter(t => t.available_until !== null).length, 6);
  assert.equal([...playables.values()].filter(p => p.playable.season !== null).length, 269);
  for (const rating of derive.RATINGS) assert.ok(s.titles.some(t => t.maturity === rating), rating);
  assert.deepEqual([count(s.history, 'prof-bisi'), count(s.progress, 'prof-bisi'), count(s.watchlist, 'prof-bisi')], [31, 9, 4]);
  // Every viewing fits its playable's runtime and release, its title's availability and its profile's ceiling.
  for (const h of s.history) {
    const {title, playable} = playables.get(h.playable_id), profile = s.profiles.find(p => p.profile_id === h.profile_id);
    assert.ok(h.seconds_watched <= playable.runtime_seconds && Date.parse(playable.released_at) <= Date.parse(h.started_at) && Date.parse(h.started_at) <= Date.parse(h.recorded_at), h.history_id);
    assert.ok(['available', 'leaving_soon'].includes(derive.availability(title, h.started_at)) && derive.canSee(profile, title), h.history_id);
    assert.ok(s.progress.some(r => r.profile_id === h.profile_id && r.playable_id === h.playable_id), 'a viewing leaves progress');
  }
  for (const r of s.progress) assert.ok(r.position_seconds <= playables.get(r.playable_id).playable.runtime_seconds);
  assert.deepEqual(s.progress.filter(r => r.set_by === 'agent').map(r => [r.profile_id, r.playable_id]), [['prof-sana', 'ep-almanac-s1e01']]);
  // Charges form unbroken periods from January 2025; the one failed charge was paid two days later.
  const paid = s.charges.filter(c => c.result === 'paid');
  assert.equal(paid[0].period_start, '2025-01-03T00:00:00-05:00');
  for (let i = 1; i < paid.length; i++) assert.equal(Date.parse(paid[i].period_start), Date.parse(paid[i - 1].period_end));
  assert.equal(paid.at(-1).period_end, s.account.paid_through);
  assert.deepEqual([s.charges.length, paid.length], [24, 23]);
  // Dates: from 2025, before the fixture clock, every one with its offset; the run counters start at zero.
  const times = [...s.history.map(h => h.started_at), ...s.activity.map(r => r.at), ...s.notifications.map(n => n.at), ...s.watchlist.map(w => w.added_at), ...s.charges.map(c => c.at)];
  assert.ok(times.every(t => /[+-]\d{2}:\d{2}$/.test(t) && Date.parse(t) >= Date.parse('2025-01-01T00:00:00Z') && Date.parse(t) < now));
  const views = s.history.map(h => Date.parse(h.started_at)).sort((a, b) => a - b);
  assert.ok(views[0] < Date.parse('2025-02-01T00:00:00Z'));
  for (let i = 1; i < views.length; i++) assert.ok(views[i] - views[i - 1] < 21 * 86400000, 'no gap of more than three weeks');
  assert.deepEqual(s.counters, {profile: 0, history: 0, charge: 0, notification: 0});
  assert.equal(s.activity.length, s.history.length + s.charges.length + s.activity.filter(r => !['playback.recorded', 'billing.charged'].includes(r.action)).length);
  assert.equal(require('../contribution/dataset.json').expected_counts.records, plugin.records(s).length);
  assert.equal(plugin.records(s).length, plugin.objects(s).length);
  assert.ok(JSON.stringify(s).length < 1024 * 1024, 'under 1 MB');
});

test('fixtures: the schedule after the clock applies in order, and none of its records is in the seed', () => {
  const schedule = require('../fixtures/schedules/late-2026.json'), s = seed(), f = fixture(), clock = require('../fixtures/clock.json').initial_time;
  assert.ok(schedule.length >= 30);
  assert.ok(Date.parse(schedule[0].at) > Date.parse(clock) && Date.parse(schedule.at(-1).at) <= Date.parse('2026-12-31T23:59:59-05:00'));
  assert.ok(schedule.some(e => e.at.startsWith('2026-12-31')), 'the schedule reaches 31 December');
  for (const kind of ['playback.recorded', 'billing.charged', 'catalog.episode_released', 'catalog.title_added', 'catalog.leaving_set', 'device.signed_in']) assert.ok(schedule.some(e => e.operation === 'lanternbox.' + kind), kind);
  const made = schedule.flatMap(e => [e.payload.title && e.payload.title.title_id, e.payload.episode && e.payload.episode.playable_id, e.payload.charge_id, e.operation.endsWith('signed_in') && e.payload.device_id]).filter(Boolean);
  assert.equal(made.length, 7); assert.ok(made.every(id => !JSON.stringify(s).includes('"' + id + '"')));
  let last = 0;
  for (const e of schedule) { assert.ok(Date.parse(e.at) >= last); last = Date.parse(e.at); const rows = f.data.activity.length; f.event(e); assert.equal(f.data.activity.length, rows + 1, e.event_id); }
  assert.ok(made.every(id => JSON.stringify(f.data).includes('"' + id + '"')));
  assert.equal(f.data.history.length, s.history.length + schedule.filter(e => e.operation.endsWith('playback.recorded')).length);
  assert.equal(f.data.account.paid_through, '2027-01-03T00:00:00-05:00');
});

test('fixtures: COVERAGE.md is the count of the delivered files', () => {
  require('node:child_process').execFileSync(process.execPath, [require('node:path').resolve(__dirname, '../scripts/coverage.cjs'), '--check'], {stdio: 'pipe'});
});

test('reviewer renderer escapes untrusted content', () => {
  const html = require('../gui/src/view.js').render([{title_id: 'x', name: '<img src=x onerror=alert(1)>', synopsis: '<script>bad</script>'}]);
  assert.ok(!html.includes('<img') && !html.includes('<script>') && html.includes('&lt;'));
});
