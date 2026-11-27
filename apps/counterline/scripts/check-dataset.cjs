'use strict';
// Load the delivery dataset through the public runtime and read it back through the Agent tools: the full
// two years at the window's end, and an as-of selection at mid-2026 with nothing dated after the cut.
// Run from a full checkout: node apps/counterline/scripts/check-dataset.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {pkg, openRun} = require('../examples/lib/run.cjs');
const {select} = require('./select-history.cjs');
const {END} = require('./generate-dataset.cjs');
const binding = require('../fixtures/binding.json');
const CUT = '2026-06-30T23:59:00-04:00';

async function load(run, data, virtual_now) {
  const r = await openRun(run);
  try { await r.load(data, binding, virtual_now); } catch (e) { await r.close(); throw e; }
  return r;
}

async function main() {
  const out = {};
  for (const family of ['card-issuer', 'internet-provider']) {
    const seed = JSON.parse(fs.readFileSync(path.join(pkg, 'datasets', family, 'seed.json'), 'utf8'));
    const full = await load(family + '-full', seed, END);
    try {
      const list = await full.agent.call('counterline.cases.list', {});
      const commitments = (await full.agent.call('counterline.commitments.list', {})).commitments;
      const first = await full.agent.call('counterline.cases.get', {case_id: list.cases[0].case_id});
      assert.equal(list.cases.length, seed.cases.length);
      assert.equal(commitments.length, seed.commitments.length);
      assert.equal(first.case.transcript.length, seed.cases[0].transcript.length);
      const statuses = {}; for (const m of commitments) statuses[m.status] = (statuses[m.status] || 0) + 1;
      out[family] = {loaded_at: END, cases: list.cases.length, commitments: commitments.length, statuses, first_case: list.cases[0].case_id, first_opened: list.cases[0].opened_at};
    } finally { await full.close(); }
    const part = select(family, CUT);
    const mid = await load(family + '-asof', part, CUT);
    try {
      const list = await mid.agent.call('counterline.cases.list', {});
      const commitments = (await mid.agent.call('counterline.commitments.list', {})).commitments;
      const later = [...list.cases.map(c => c.opened_at), ...commitments.map(m => m.accepted_at), ...commitments.flatMap(m => m.reports.map(r => r.at))].filter(t => Date.parse(t) > Date.parse(CUT));
      assert.equal(later.length, 0, 'nothing after the cut');
      assert.ok(list.cases.length > 0 && list.cases.length < seed.cases.length);
      out[family].as_of = {cut: CUT, cases: list.cases.length, commitments: commitments.length, records_after_cut: later.length};
    } finally { await mid.close(); }
  }
  return out;
}

module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: dataset loads and reads back through MCP, full and as-of.'); })
  .catch(e => { console.error(e); process.exit(1); });
