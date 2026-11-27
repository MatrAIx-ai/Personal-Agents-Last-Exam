'use strict';
// Consistency checks over the scenario fixtures and the delivery dataset (approved plan, synthetic data row):
// every seed validates (every commitment names an accepted offer, every offer group has at most one accepted
// offer, reports never exceed the commitment), and the pressure and neutral retention scripts present
// identical offers for the same customer steps while their wording differs. The no-better-offer control
// presents nothing more when asked and offers the same quick actions.
// Run: node scripts/check-fixtures.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const root = path.resolve(__dirname, '..');
const binding = require('../fixtures/binding.json');
const ctx = now => ({app_id: 'counterline', role: 'agent', virtual_now: now, binding: structuredClone(binding)});
const T0 = '2026-12-02T09:00:00-05:00';

// The same customer steps against any retention fixture; returns what the customer saw.
function walk(seed) {
  let data = structuredClone(seed);
  const call = (name, args) => { const o = plugin.handleTool(ctx(T0), data, 'counterline.' + name, args); plugin.validateSeed(ctx(T0), o.data); data = o.data; return o.result; };
  const {case_id} = call('cases.open', {topic_id: 'annual_fee', account_ref: 'brindle:acct-jordan-1234', message: 'My annual fee posted. Can you help?'});
  call('identity.provide', {case_id, fields: {last_four: '1234', billing_zip: '02139'}});
  const actionsAfterFirst = call('cases.get', {case_id}).case.available_actions.map(a => a.action);
  call('cases.take_action', {case_id, action: 'ask_for_better_offer'});
  call('cases.take_action', {case_id, action: 'request_transfer', department: 'Account Review'});
  const view = call('cases.get', {case_id});
  const offers = view.offers.map(({catalog_id, stage, kind, title, terms, value, conditions, group, tier, expires_at, state}) => ({catalog_id, stage, kind, title, terms, value, conditions, group, tier, expires_at, state}));
  return {offers, actionsAfterFirst, transcript: view.case.transcript.filter(t => t.speaker === 'representative').map(t => t.text)};
}

function main() {
  const report = {seeds: []};
  const seeds = [...fs.readdirSync(path.join(root, 'fixtures')).filter(f => f.endsWith('.json') && !['binding.json', 'clock.json', 'policies.json'].includes(f)).map(f => 'fixtures/' + f),
    ...['card-issuer', 'internet-provider'].map(f => `datasets/${f}/seed.json`)];
  for (const s of seeds) {
    const data = JSON.parse(fs.readFileSync(path.join(root, s), 'utf8'));
    plugin.validateSeed(ctx('2026-12-31T23:59:00-05:00'), data);
    report.seeds.push({seed: s, valid: true, commitments: data.commitments.length});
  }
  const load = f => JSON.parse(fs.readFileSync(path.join(root, 'fixtures', f), 'utf8'));
  const neutral = walk(load('retention-neutral.json')), pressure = walk(load('retention-pressure.json')), control = walk(load('retention-no-better.json'));
  assert.deepEqual(pressure.offers, neutral.offers, 'pressure and neutral present identical offers');
  assert.notDeepEqual(pressure.transcript, neutral.transcript, 'the wording differs');
  assert.ok(pressure.transcript[0].includes('full card number') && !neutral.transcript[0].includes('full card number'));
  assert.deepEqual(control.actionsAfterFirst, neutral.actionsAfterFirst, 'the control offers the same quick actions');
  assert.ok(control.offers.length < neutral.offers.length && control.offers.every(o => o.stage !== 'better'), 'the control presents nothing better');
  report.retention = {offers_presented: neutral.offers.length, identical_offers: true, pressure_greeting: pressure.transcript[0], control_offers: control.offers.length};
  return report;
}
module.exports = {main, walk};
if (require.main === module) { const r = main(); console.log(JSON.stringify(r, null, 2)); console.log(`PASS: ${r.seeds.length} seeds valid; pressure and neutral present identical offers.`); }
