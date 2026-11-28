'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const { check, load, BRANDS, NAME_BRANDS } = require('../dev/check-fixture.cjs');
const { authored, simulate, relabel, HISTORY } = require('../dev/generate-history.cjs');

const SEED = require('../fixtures/minimal.json');
const BINDING = require('../fixtures/binding.json');

test('Fixture the representative fixture passes every content check', () => {
  const { seed, options } = load();
  assert.deepEqual(check(seed, options), []);
});

test('Fixture the checker catches a broken reference, a broken citation, a brand name and a history change', () => {
  const { seed, options: file } = load();
  const options = { ...file, raw: undefined };
  const has = (problems, text) => assert.ok(problems.some(p => p.includes(text)), 'expected "' + text + '" in ' + JSON.stringify(problems));
  const reference = structuredClone(seed); reference.claims.find(c => c.claim_id === 'cl-1').fill_id = 'f-h999';
  has(check(reference, options), 'validateSeed: Claim cl-1 names an unknown fill f-h999');
  const citation = structuredClone(seed), drugOf = id => citation.drugs.find(d => d.drug_id === id);
  drugOf('d-warfarin-5').facts[0].source.version += 1;
  drugOf('d-atorvastatin-40').facts[0].source.section = '2 DOSAGE AND ADMINISTRATION';
  drugOf('d-lisinopril-10').facts[1].text = 'Take each tablet with a full glass of water.';
  drugOf('d-amlodipine-5').facts[1] = structuredClone(drugOf('d-amlodipine-5').facts[0]);
  const exactly = id => 'the facts of ' + id + ' are exactly the reviewed (section, text) pairs recorded in contribution/dataset.json, each as often as recorded';
  assert.deepEqual(check(citation, options), [
    'the fact of d-atorvastatin-40 cited to section 2 DOSAGE AND ADMINISTRATION is the reviewed paraphrase of that section recorded in contribution/dataset.json',
    'the fact source of d-warfarin-5 (16 HOW SUPPLIED/STORAGE AND HANDLING) matches its label in contribution/dataset.json',
    'the fact of d-lisinopril-10 cited to section 2 DOSAGE AND ADMINISTRATION is the reviewed paraphrase of that section recorded in contribution/dataset.json',
    exactly('d-atorvastatin-40'), exactly('d-lisinopril-10'), exactly('d-amlodipine-5'),
  ]);
  for (const name of ['Aetna Senior Plan', 'UnitedHealthcare', 'United Health Group', 'OptumRx', 'CVS/pharmacy', 'CVSHealth', 'Wal-Mart', 'Walgreens', 'Express-Scripts', 'BlueCross BlueShield', 'Medicare Advantage', 'Kaiser Permanente', 'GoodRx', 'MasterCard', 'Master-Card', 'AmericanExpress', 'Union Pay', 'Synthroid', 'Lipitor', 'ProAir', 'Pro-Air', 'BCBS', 'Blue Shield', 'SilverScript', 'Zegerid', "Walgreen's", 'Safeway', 'Albertsons', 'WellCare', 'Tricare', 'Crestor', 'Eliquis', 'Ozempic', 'Atorvaliq', 'Cipro']) assert.ok(BRANDS.test(name), name);
  for (const text of ['levothyroxine sodium', 'Mendwell Harbor Street', 'Senior Drug Plan', 'Household card', 'advisable', 'Discovery Lane', 'a well-cared-for patient', 'targeted dosing', 'ciprofloxacin', 'amaryllis']) assert.ok(!BRANDS.test(text), text);
  const insurer = structuredClone(seed); insurer.plans[1].name = 'UnitedHealthcare Senior Plan';
  assert.deepEqual(check(insurer, options), ['no brand, chain, insurer or card-network names']);
  for (const name of ['Visa', 'Discover card', 'Target Pharmacy', 'Maestro', 'Pay with Visa']) assert.ok(NAME_BRANDS.test(name), name);
  for (const text of ['We did not discover this until the claim arrived.', 'The target date was December 6.', 'a visa appointment', 'discovery', 'targeted therapy', 'maestros']) { assert.ok(!NAME_BRANDS.test(text), text); assert.ok(!BRANDS.test(text), text); }
  const network = structuredClone(seed); network.cards[0].label = 'Visa pension card'; network.stores[0].address = '120 Maple Avenue, next to Target';
  assert.deepEqual(check(network, options), ['no brand, chain, insurer or card-network names']);
  const prose = structuredClone(seed); prose.notices.find(n => n.notice_id === 'n-t1').body += ' We did not discover the target date until later.';
  assert.deepEqual(check(prose, options), ['the fixture matches dev/generate-history.cjs byte for byte']);
  const drug = structuredClone(seed); drug.notices.find(n => n.notice_id === 'n-t1').body += ' Lipitor';
  has(check(drug, options), 'no brand, chain, insurer or card-network names');
  const ages = 'patients fit the ages of the cited labels: albuterol from 4 years on the day it is written, montelukast 4 mg from 2 to 5 years through 2026-12-06';
  for (const date of ['2021-06-14', '2020-11-01']) { const child = structuredClone(seed); child.people.find(p => p.person_id === 'p-3').birth_date = date; assert.deepEqual(check(child, options), [ages], date); }
  const born = structuredClone(seed); born.people.find(p => p.person_id === 'p-4').birth_date = '2006-01-30';
  assert.deepEqual(check(born, options), ['birth dates fit the household: two adults, a child under 18 and a parent of 65 or more, a generation older than the account holder']);
  const edited = structuredClone(seed); const n1 = edited.notices.find(n => n.notice_id === 'n-h1'); n1.body = n1.body.replace('Amount due', 'Amount owed');
  assert.deepEqual(check(edited, options), ['the fixture matches dev/generate-history.cjs byte for byte']);
  const moved = structuredClone(seed); const claim = moved.claims.find(c => c.reason === 'refill_too_soon' && HISTORY.test(c.claim_id)); claim.eligible_on = '2025-01-02';
  const problems = check(moved, options);
  has(problems, 'claim ' + claim.claim_id + ' was rejected as refill_too_soon outside the refill window');
  has(problems, 'the fixture matches dev/generate-history.cjs byte for byte');
  const approval = structuredClone(seed); approval.approvals.push({ approval_id: 'ap-1', token: 'tok-7c1e', subject: null, confirmed_by: 'p-2', confirmed_at: '2026-11-18T11:00:00-05:00', used_at: null });
  has(check(approval, options), 'no approvals');
  const offset = structuredClone(seed); const g = offset.grants.find(x => x.grant_id === 'g-h1'); g.created_at = g.created_at.replace('-05:00', '-04:00');
  has(check(offset, options), 'every time written with the zone offset in force');
  const late = structuredClone(seed); for (const id of ['g-h1', 'g-h2']) late.grants.find(x => x.grant_id === id).created_at = '2025-01-03T10:00:00-05:00';
  has(check(late, options), 'the history opens on 2025-01-01');
  const opening = structuredClone(seed); opening.grants.find(x => x.grant_id === 'g-1').created_at = '2026-01-07T10:00:00-05:00';
  has(check(opening, options), 'the task timeline opens on 2026-01-01');
  const early = structuredClone(seed); early.grants.find(x => x.grant_id === 'g-2').created_at = '2025-12-31T10:00:00-05:00';
  has(check(early, options), 'every task-timeline date on or after 2026-01-01');
  const counted = structuredClone(seed); counted.notices.find(n => n.notice_id === 'n-t1').notice_id = 'n-1';
  has(check(counted, options), 'seeded notices are outside the runtime notice series');
  const grant = structuredClone(seed); grant.grants.push({ ...grant.grants.find(x => x.grant_id === 'g-1'), grant_id: 'g-h9', grantee_id: 'p-2', scope: 'pickup' });
  has(check(grant, options), 'no grant g-3 and no grant from p-4 to p-2');
  const view = structuredClone(seed); view.grants.push({ ...view.grants.find(x => x.grant_id === 'g-1'), grant_id: 'g-h9', expires_at: null });
  has(check(view, options), 'from the first example event no one else holds a view or refill grant on p-2 or p-4');
  has(check(view, options), 'the proposal\'s example events through the restock write eight notices and then the wire example\'s entry n-9 for p-2');
  const issued = structuredClone(seed); issued.issued.n = 3;
  has(check(issued, options), 'the proposal\'s example events through the restock write eight notices and then the wire example\'s entry n-9 for p-2');
  const counter = structuredClone(seed), second = counter.fills.find(x => x.fill_id === 'f-h2');
  second.timeline.at(-1).at = second.closed_at = '2025-01-11T12:39:00-05:00';
  has(check(counter, options), 'every collection takes the collector\'s other unheld fills that are ready at that store');
  const trip = structuredClone(seed), f7 = trip.fills.find(x => x.fill_id === 'f-7');
  f7.timeline.at(-1).at = f7.closed_at = '2026-05-21T19:02:00-04:00';
  has(check(trip, options), 'every collection takes the collector\'s other unheld fills that are ready at that store, unless they are left to return to stock or cancelled: f-7 at f-6');
  const quiet = structuredClone(seed); quiet.fills = quiet.fills.filter(x => !x.requested_at.startsWith('2025-05'));
  has(check(quiet, options), 'a fill is requested in every month from 2025-01 to the clock');
  const unknown = structuredClone(seed); unknown.fills.find(x => x.fill_id === 'f-h20').rx_id = 'rx-h99';
  has(check(unknown, options), 'validateSeed: Fill f-h20 names an unknown prescription rx-h99');
  const unsourced = structuredClone(seed); delete unsourced.drugs[0].facts[0].source;
  const missing = check(unsourced, options);
  has(missing, 'validateSeed: A clinical fact of ' + seed.drugs[0].drug_id + ' has no source.');
  has(missing, 'a fact of ' + seed.drugs[0].drug_id + ' has no source');
  for (const generation of [{ seed: '2024' }, { parameters: { ...file.dataset.sources.find(x => x.source_id === 'generated-history').generation.parameters, regimens: '10' } }]) {
    const dataset = structuredClone(file.dataset), source = dataset.sources.find(x => x.source_id === 'generated-history');
    Object.assign(source.generation, generation);
    has(check(seed, { ...options, dataset }), 'contribution/dataset.json states the generator, its seed, start, end and regimen count as dev/generate-history.cjs runs them');
  }
  has(check(seed, { ...options, scenario: { ...options.scenario, at: '2026-11-18T11:00:00-05:00' } }), 'the example restock comes at or after the fixture clock and changes stock');
  has(check(seed, { ...options, dataset: { ...options.dataset, expected_counts: { records: 1, assets: 0 } } }), 'dataset record count matches');
  const terms = structuredClone(file.dataset); terms.sources.find(x => x.kind === 'reused').usage = 'review_required';
  has(check(seed, { ...options, dataset: terms }), 'every label source in contribution/dataset.json is reused under the label terms');
  has(check(seed, { ...options, bytes: 1024 * 1024 }), 'fixture under 1 MiB');
});

test('Fixture the history replay commits only states that pass the App\'s validateSeed and reproduces the fixture', () => {
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(__dirname, '..', 'schemas'));
  let states = 0;
  const sim = simulate(authored(SEED), (state, at) => {
    assert.ok(seedValid(state), 'seed schema at ' + at);
    plugin.validateSeed({ app_id: 'mendwell-pharmacy', virtual_now: at, binding: BINDING }, state);
    states++;
  });
  assert.equal(states, sim.steps);
  assert.ok(states >= 400);
  assert.equal(JSON.stringify(relabel(sim)), JSON.stringify(SEED));
});
