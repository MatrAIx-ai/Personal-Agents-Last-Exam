'use strict';
// Fixture and schedule checks from the proposal: every reset fixture passes
// validateSeed, amounts add up to the cent, no site has a night taken twice,
// every filter matches some open sites and excludes others, IDs are unique, and
// each default schedule has 30-50 events that apply in order. Schedules and
// claim times are evaluator-side: nothing an Agent or page runs reads them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('./harness.cjs');
const generator = require('../fixtures/generate.cjs');

const root = path.resolve(__dirname, '..');
const FIXTURES = ['minimal', 'high-country', 'desert-rivers'];
const load = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const seedOf = name => load(`fixtures/${name}.json`);
const scheduleOf = name => load(`fixtures/schedules/${name}.json`);
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('the generator reproduces every committed fixture, schedule and the manifest clock byte for byte', () => {
  for (const [rel, content] of Object.entries(generator.build())) {
    assert.equal(fs.readFileSync(path.join(root, 'fixtures', rel), 'utf8'), content, rel);
  }
  assert.equal(load('fixtures/schedules/minimal.json').initial_time, load('fixtures/clock.json').initial_time);
  assert.equal(load('app.json').fixtures.seed, 'fixtures/minimal.json');
});

for (const name of FIXTURES) {
  test(`fixture ${name}: validateSeed, unique IDs, amounts to the cent, no night taken twice`, () => {
    const seed = seedOf(name), schedule = scheduleOf(name);
    fixture({seed, now: schedule.initial_time, logging: false});  // seed schema and validateSeed
    for (const key of ['facilities', 'policies', 'sites', 'equipment', 'companions', 'reservations', 'payments', 'alerts', 'closures', 'claims', 'notices']) {
      const ids = seed[key].map(x => x.id);
      assert.equal(new Set(ids).size, ids.length, `duplicate ID in ${key}`);
    }
    assert.equal(new Set(seed.wallet.cards.map(c => c.id)).size, seed.wallet.cards.length);
    // Amounts: integer cents; charges equal the stay total; a refund matches its history row.
    for (const r of seed.reservations) {
      assert.equal(r.nightly_cents.reduce((a, b) => a + b, 0), r.total_cents, r.id);
      const sum = kind => seed.payments.filter(p => p.reservation_id === r.id && p.kind === kind).reduce((a, p) => a + p.amount_cents, 0);
      assert.equal(sum('charge'), r.total_cents, r.id + ' charges');
      const cancel = r.history.find(h => h.action === 'cancelled');
      assert.equal(sum('refund'), cancel ? cancel.refund_cents : 0, r.id + ' refunds');
      assert.ok(sum('refund') <= sum('charge'));
    }
    for (const p of seed.payments) assert.ok(Number.isInteger(p.amount_cents) && p.amount_cents > 0, p.id);
    // A site night is held by at most one stay that was not cancelled, or one claim.
    const nights = new Map();
    const take = (site, date, who) => {
      const key = site + '|' + date;
      assert.ok(!nights.has(key), `${key} taken by ${nights.get(key)} and ${who}`);
      nights.set(key, who);
    };
    for (const r of seed.reservations) if (r.state !== 'cancelled') for (const d of r.nights) take(r.site_id, d, r.id);
    for (const c of seed.claims) for (const d of c.nights) take(c.site_id, d, c.id);
    // Size targets from the proposal (the manifest seed is the small M1 fixture).
    if (name !== 'minimal') {
      assert.ok(seed.facilities.length >= 6 && seed.facilities.length <= 8);
      assert.ok(seed.sites.length >= 250 && seed.sites.length <= 400);
      assert.ok(seed.policies.length >= 2 && seed.policies.some(p => p.id === 'pol-standard'));
      assert.equal(seed.wallet.cards.length, 3);
      assert.equal(new Set(seed.wallet.cards.map(c => c.holder_person_id)).size, 2);
      assert.ok(seed.equipment.length >= 2 && seed.equipment.length <= 3);
      assert.ok(seed.companions.length >= 4 && seed.companions.length <= 8);
      for (const k of ['electric_amps', 'max_vehicle_ft', 'ada_accessible', 'walk_in_ft', 'max_occupancy', 'pets_allowed']) {
        assert.ok(new Set(seed.sites.map(s => s[k])).size > 1, 'attribute varies: ' + k);
      }
      for (const k of ['max_vehicle_ft', 'ada_accessible', 'pets_allowed']) assert.ok(seed.sites.some(s => s[k] === null), 'some unknown ' + k);
    }
  });

  test(`fixture ${name}: every search filter matches some open sites and excludes others`, () => {
    const schedule = scheduleOf(name), f = fixture({seed: seedOf(name), now: schedule.initial_time, logging: false});
    const arrival = addDays(schedule.initial_time.slice(0, 10), 10), departure = addDays(arrival, 2);
    const ids = args => f.call('sites.search', {arrival, departure, available_only: true, ...args}).sites.map(s => s.id);
    const open = ids({});
    assert.ok(open.length > 0);
    const filters = [{electric_min_amps: 30}, {min_vehicle_ft: 30}, {ada_accessible: true}, {ada_accessible: false}, {max_walk_in_ft: 100},
      {party_size: 8}, {pets: true}, {pets: false}];
    for (const filter of filters) {
      const matched = ids(filter);
      assert.ok(matched.length > 0, 'matches some: ' + JSON.stringify(filter));
      assert.ok(matched.length < open.length, 'excludes some: ' + JSON.stringify(filter));
      assert.ok(matched.every(id => open.includes(id)));
    }
    // An unknown attribute never matches its filter.
    const seed = seedOf(name);
    for (const [k, filter] of [['max_vehicle_ft', {min_vehicle_ft: 1}], ['ada_accessible', {ada_accessible: true}], ['pets_allowed', {pets: true}]]) {
      const unknown = new Set(seed.sites.filter(s => s[k] === null).map(s => s.id));
      assert.ok(ids(filter).every(id => !unknown.has(id)), 'unknown ' + k);
    }
  });

  test(`schedule ${name}: 30-50 events in time order, valid, applied in order without a rejection`, () => {
    const schedule = scheduleOf(name), times = load(`fixtures/evaluator/${name}.claim-times.json`).times;
    assert.equal(schedule.fixture, name);
    assert.ok(schedule.events.length >= 30 && schedule.events.length <= 50, String(schedule.events.length));
    assert.equal(new Set(schedule.events.map(e => e.event_id)).size, schedule.events.length);
    const claims = schedule.events.filter(e => e.operation === 'switchback.inventory.claimed');
    assert.deepEqual(Object.fromEntries(claims.map(e => [e.event_id, e.at])), times);
    let previous = Date.parse(schedule.initial_time);
    const f = fixture({seed: seedOf(name), now: schedule.initial_time, logging: false});
    for (const e of schedule.events) {
      assert.ok(Date.parse(e.at) >= previous, e.event_id + ' in order');
      previous = Date.parse(e.at);
      f.event(e);  // schema-checked; throws on any rejection
    }
    assert.ok(Date.parse(schedule.end_time) >= previous);
  });
}

test('schedules and claim times are evaluator-side: no tool, page or business source reads them', () => {
  const files = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, {withFileTypes: true})) e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.join(dir, e.name)); };
  for (const dir of ['src', 'gui']) if (fs.existsSync(path.join(root, dir))) walk(path.join(root, dir));
  files.push(...['plugin.cjs', 'service.cjs', 'tools.json', 'app.json'].map(f => path.join(root, f)));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const word of ['schedules', 'claim-times', 'evaluator']) assert.ok(!text.includes(word), `${path.relative(root, file)} mentions ${word}`);
  }
});

module.exports = {FIXTURES, seedOf, scheduleOf};
