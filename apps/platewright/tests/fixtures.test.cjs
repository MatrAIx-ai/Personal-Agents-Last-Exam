'use strict';
// Both fixtures pass scripts/check-fixtures.cjs, and the reference household reads as intended.
const test = require('node:test');
const assert = require('node:assert/strict');
const {run} = require('../scripts/check-fixtures.cjs');
const {fixture} = require('./harness.cjs');
const P = 'platewright.';

test('fixtures pass the consistency checks and match their declared counts', () => {
  const report = run();
  assert.deepEqual(report.results.map(r => [r.file, r.problems]), [['fixtures/minimal.json', []], ['fixtures/reference.json', []]]);
  assert.equal(report.declared_counts.passed, true, report.declared_counts.detail);
  assert.equal(report.passed, true);
});

test('the reference household: Saturday\'s guests, a stale list after Friday changed, and reads that write nothing', () => {
  const f = fixture({seed: require('../fixtures/reference.json')}), before = JSON.stringify(f.data);
  const six = f.call(P + 'recipes.get', {id: 'rec-green-curry', servings: 6}).recipe;
  assert.deepEqual(six.lines.slice(0, 2).map(l => [l.quantity, l.unit]), [[1050, 'ml'], [9, 'tbsp']]);
  assert.deepEqual([six.revision, six.lines[5].quantity], [2, 6]);
  const sat = f.call(P + 'plan.get', {start: '2026-11-14', end: '2026-11-14'}).slots.find(s => s.meal === 'dinner');
  assert.deepEqual([sat.default_servings, sat.flags.map(x => x.id + ':' + x.verdict)], [6, ['guest-ines:unsuitable', 'guest-maya:unsafe']]);
  const list = f.call(P + 'shopping.get', {}).list;
  assert.deepEqual([list.stale, list.start, list.end, list.lines.filter(l => l.state === 'ticked').length, list.lines.filter(l => l.kind === 'manual').length], [true, '2026-11-09', '2026-11-15', 2, 2]);
  const variants = f.call(P + 'recipes.search', {query: 'curry', limit: 100}).items.filter(r => r.variant_of === 'rec-green-curry');
  assert.deepEqual(variants.map(v => [v.id, f.call(P + 'recipes.get', {id: v.id}).recipe.variant.stale_base]).sort(),
    [['rec-green-curry-with-tamari', true], ['rec-nut-free-green-curry', false]]);
  // 60 notifications from the generated history since 2025-01-01, then the 14 hand-written ones, which keep their IDs.
  const all = f.call(P + 'notifications.list', {}).notifications;
  assert.deepEqual([all.length, all[0].at.slice(0, 10) >= '2025-01-01', all.filter(n => n.id.startsWith('ntf-h')).length], [74, true, 60]);
  assert.deepEqual(f.call(P + 'notifications.list', {start: '2026-10-12'}).notifications.map(n => n.id), Array.from({length: 14}, (_, i) => 'ntf-' + String(i + 1).padStart(4, '0')));
  assert.equal(JSON.stringify(f.data), before);
});

test('two years of history: reads default to a week or a page, and past slots read from their own date', () => {
  const f = fixture({seed: require('../fixtures/reference.json')});
  const week = f.call(P + 'plan.get', {});
  assert.deepEqual([week.start, week.end], ['2026-11-02', '2026-11-08']);
  assert.equal(f.call(P + 'recipes.search', {}).items.length <= 20, true);
  assert.equal(f.refuse(P + 'plan.get', {start: '2025-01-01', end: '2025-03-31'}), 'invalid_window');
  const first = f.call(P + 'plan.get', {start: '2025-01-01', end: '2025-01-07'}).slots;
  assert.ok(first.length >= 7 && first.every(s => s.phase === 'past' && ['cooked', 'skipped', 'cleared'].includes(s.state) && !s.flags.length));
  // February 2025: Nora's meat-free month (con-nora-h1) is respected by every dinner she sat at.
  const feb = f.call(P + 'plan.get', {start: '2025-02-03', end: '2025-03-02'}).slots.filter(s => s.attendees.includes('person-nora') && s.state === 'cooked' && !s.dishes[0].leftovers_of);
  assert.ok(feb.length > 20 && feb.every(s => f.call(P + 'recipes.check', {id: s.dishes[0].recipe_id, members: ['person-nora'], date: s.date}).verdicts[0].verdict === 'ok'));
  const household = f.call(P + 'household.get', {date: '2025-02-10'}).members.find(m => m.person_id === 'person-nora');
  assert.equal(household.constraints.find(c => c.id === 'con-nora-h1').state, 'active');
});

test('the fixture check replays each slot\'s history and refuses histories the App could not have written', () => {
  const {recordProblems} = require('../scripts/check-fixtures.cjs');
  const problems = data => { const out = []; recordProblems(data, m => out.push(m)); return out; };
  const slot = (data, id) => data.plan.find(s => s.id === id);
  const dropFirst = id => d => { slot(d, id).history.shift(); };
  const BROKEN = {
    reference: [
      // The planning row of a generated meal that was later cleared, replaced or given a guest is kept.
      ['cleared by the account, plan dropped', dropFirst('2025-01-18:breakfast')],
      ['cleared by a member, plan dropped', dropFirst('2025-02-04:dinner')],
      ['replaced by a member, plan dropped', dropFirst('2025-01-08:dinner')],
      ['guest added, plan dropped', dropFirst('2025-01-04:dinner')],
      // A hand-written meal keeps its planning row even when it was cooked as planned.
      ['hand-written meal, plan dropped', dropFirst('2026-10-12:dinner')],
      ['cooked other dishes than planned', d => { slot(d, '2026-10-12:dinner').history[1].dishes = [{recipe_id: 'rec-dal', servings: null}]; }],
      ['cooked with other people than planned', d => { slot(d, '2025-01-08:dinner').history.at(-1).attendees = ['person-nora']; }],
      ['cleared after it was cooked', d => { const s = slot(d, '2026-10-12:dinner'); s.history.push({...s.history.at(-1), action: 'cleared', dishes: []}); }],
      ['cooked twice', d => { const s = slot(d, '2025-01-01:dinner'); s.history.push({...s.history[0]}); }],
      ['state differs from the history', d => { slot(d, '2025-01-21:dinner').state = 'cleared'; }],
      ['slot differs from its last row', d => { slot(d, '2025-01-18:breakfast').attendees = ['person-nora']; }],
      ['cooked before its date', d => { const s = slot(d, '2026-10-12:dinner'); s.history[1].at = s.cooked.at = s.updated_at = '2026-10-11T19:00:00-04:00'; }],
      ['planned after its date', d => { slot(d, '2025-01-18:breakfast').history[0].at = '2025-01-19T08:00:00-05:00'; }],
      ['a guest row that adds nobody', d => { const h = slot(d, '2025-01-04:dinner').history[1]; h.guest_ids = []; }],
      ['an event row without its event', d => { slot(d, '2025-02-04:dinner').history[1].event_id = 'ev-pw-h9999'; }],
      ['set twice without replacing', d => { const s = slot(d, '2026-10-21:dinner'); s.history.splice(1, 0, {...s.history[0]}); }]
    ],
    minimal: [
      ['cleared, plan dropped', dropFirst('2026-11-05:lunch')],
      ['skipped, plan dropped', dropFirst('2026-11-01:dinner')],
      ['cooked, plan dropped', dropFirst('2026-11-07:dinner')]
    ]
  };
  for (const [name, cases] of Object.entries(BROKEN)) {
    const good = require(`../fixtures/${name}.json`);
    assert.deepEqual(problems(structuredClone(good)), [], name);
    for (const [label, breakIt] of cases) {
      const copy = structuredClone(good);
      breakIt(copy);
      assert.notDeepEqual(problems(copy), [], `${name}: ${label} was not refused`);
    }
  }
});

test('the committed dataset coverage report matches the fixture as the App loads it', () => {
  const fs = require('node:fs'), path = require('node:path');
  const {outputs} = require('../scripts/dataset-coverage.cjs');
  for (const [file, text] of Object.entries(outputs())) {
    assert.equal(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), text, file + ' is out of date: run node scripts/dataset-coverage.cjs');
  }
  const report = JSON.parse(outputs()['evidence/dataset-coverage.json']);
  assert.equal(report.totals.records_core_counts, require('../contribution/dataset.json').expected_counts.records);
  assert.equal(report.totals.earliest_date, '2025-01-01');
});
