'use strict';
// The three seeds against the proposal's data checks: validateSeed and the seed
// schema pass, the balance reconciles to the cent, every notice maps to one
// toll, a plate's possession intervals do not overlap, the account shape the
// proposal names, the SHA-256 recorded in dataset.json, and the example
// schedule applying cleanly.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/rules.cjs');
const C = require('../src/clock.cjs');
const {fixture, seedFiles, SEEDS} = require('./harness.cjs');

const root = path.resolve(__dirname, '..');
const dataset = require('../contribution/dataset.json');

// The stale vehicle (still listed after it left the household) and the temporary plate of each seed.
const STORY = {
  dani: {owner: 'person-dani', stale: ['v-0002', 'v-0003'], temporary: 'v-0005'},
  marisol: {owner: 'person-marisol', stale: ['v-0003'], temporary: 'v-0004'},
  theo: {owner: 'person-theo', stale: ['v-0003'], temporary: 'v-0005'},
};

for (const s of SEEDS) {
  const {data, now, binding, schedule} = seedFiles(s.seed_id);
  const t = C.ms(now);

  test(`${s.seed_id}: validates against the seed schema and validateSeed`, () => {
    fixture({id: s.seed_id});  // the harness validates both on load
    assert.equal(data.account_id, s.account_id);
    assert.ok(binding.accounts.some(a => a.app_id === 'crossway' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id));
    for (const [kind, ids] of Object.entries(binding.objects)) {
      for (const id of ids) assert.ok(data[kind].some(x => x.id === id), `${kind} ${id} in the binding exists`);
    }
  });

  test(`${s.seed_id}: the balance reconciles to the cent with the ledger and the statements`, () => {
    let balance = 0;
    for (const row of data.ledger) {
      balance += row.amount_cents;
      assert.equal(row.balance_cents, balance, row.id);
    }
    assert.equal(balance, data.balance_cents);
    let opening = 0;
    for (const st of data.statements) {
      const start = C.midnight(`${st.period}-01`), end = C.midnight(`${C.nextMonth(st.period)}-01`);
      const rows = data.ledger.filter(l => C.ms(l.at) >= start && C.ms(l.at) < end);
      assert.equal(st.opening_balance_cents, opening, st.id);
      assert.equal(st.closing_balance_cents, opening + rows.reduce((sum, l) => sum + l.amount_cents, 0), st.id);
      opening = st.closing_balance_cents;
    }
  });

  test(`${s.seed_id}: every notice maps to exactly one toll, and every noticed toll to its notice`, () => {
    for (const n of data.notices) {
      const tolls = data.tolls.filter(x => x.id === n.toll_id);
      assert.equal(tolls.length, 1, n.id);
      assert.equal(tolls[0].notice_id, n.id);
      assert.equal(data.tolls.filter(x => x.notice_id === n.id).length, 1, n.id);
    }
    for (const toll of data.tolls.filter(x => x.disposition === 'noticed')) {
      assert.equal(data.notices.filter(n => n.toll_id === toll.id).length, 1, toll.id);
    }
  });

  test(`${s.seed_id}: a plate's possession intervals do not overlap`, () => {
    const byPlate = new Map();
    for (const v of data.vehicles) byPlate.set(v.plate, [...(byPlate.get(v.plate) || []), v]);
    for (const [plate, list] of byPlate) {
      const sorted = [...list].sort((a, b) => (a.possession_start < b.possession_start ? -1 : 1));
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i - 1].possession_end !== null && sorted[i - 1].possession_end < sorted[i].possession_start, plate);
      }
    }
  });

  test(`${s.seed_id}: the account shape the proposal names`, () => {
    const story = STORY[s.seed_id];
    assert.ok(data.vehicles.length >= 3 && data.vehicles.length <= 5, 'three to five vehicles');
    for (const id of story.stale) assert.equal(data.vehicles.find(v => v.id === id).ended_at, null, `stale vehicle ${id} still listed`);
    const temp = data.vehicles.find(v => v.id === story.temporary);
    assert.ok(temp.temporary && temp.possession_end !== null, 'one temporary plate');
    assert.equal(data.cards.length, 3);
    assert.ok(data.cards.some(c => c.holder_person_id === story.owner && R.cardProblem(c, t) === null), 'the user\'s valid card');
    assert.ok(data.cards.some(c => c.holder_person_id === story.owner && R.cardExpired(c, t)), 'an expired card');
    assert.ok(data.cards.some(c => c.holder_person_id !== story.owner), 'another person\'s card');
    const plazas = new Set(data.tolls.map(x => x.plaza_id));
    assert.ok(plazas.size >= 12 && plazas.size <= 16, 'tolls across 12-16 plazas');
    assert.ok(new Set(data.notices.map(n => n.state)).size >= 4, 'notices in mixed states');
    assert.ok(data.notices.some(n => ['issued', 'escalated', 'disputed'].includes(n.state)), 'open notices');
  });

  test(`${s.seed_id}: dataset.json records the seed file and its SHA-256`, () => {
    const source = dataset.sources.find(x => x.generation?.parameters?.seed_id === s.seed_id);
    assert.ok(source, 'source for ' + s.seed_id);
    const p = source.generation.parameters;
    assert.equal(p.file, 'apps/crossway/' + s.seed);
    assert.equal(p.clock, now);
    assert.equal(p.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, s.seed))).digest('hex'));
    assert.equal(p.counts.records, data.tolls.length + data.notices.length);
  });

  test(`${s.seed_id}: the example schedule applies event by event`, () => {
    const f = fixture({id: s.seed_id});
    for (const e of schedule.events) f.event(e);
    assert.ok(f.data.outgoing.length > 0, 'the schedule produces Mail notices');
  });
}

test('the manifest seed is dani, and expected_counts matches its records', () => {
  const plugin = require('../plugin.cjs');
  assert.equal(require('../app.json').fixtures.seed, SEEDS[0].seed);
  assert.equal(dataset.expected_counts.records, plugin.records(seedFiles('dani').data).length);
});
