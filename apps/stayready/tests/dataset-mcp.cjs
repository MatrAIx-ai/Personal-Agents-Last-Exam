'use strict';
// Public Infra seed loading and separate Agent MCP retrieval for every delivered seed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const app = path.resolve(__dirname, '..');
const runtimeRoot = process.env.PALE_RUNTIME_ROOT || path.join(root, 'runtime');
const { prepare } = require(path.join(runtimeRoot, 'prepare.cjs'));
const { Client } = require(path.join(runtimeRoot, 'client.cjs'));
const { digestTree } = require(path.join(runtimeRoot, 'verify.cjs'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const counts = data => ({ property: 1, stay: 1, ...Object.fromEntries(['people', 'sources', 'needs', 'requests', 'commitments', 'history'].map(key => [key, data[key].length])) });

async function main() {
  const output = path.resolve(process.env.STAYREADY_REPORT_DIR || path.join(app, '.artifacts/dataset'));
  fs.mkdirSync(output, { recursive: true });
  const manifestFile = path.join(app, 'datasets/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  const bindingBytes = fs.readFileSync(path.join(app, 'fixtures/binding.json'));
  const binding = JSON.parse(bindingBytes);
  const report = { schema: 'stayready.dataset-mcp-evidence.v1', started_at: new Date().toISOString(),
    node: process.version, runtime: require(path.join(runtimeRoot, 'package.json')).version,
    app_sha256: digestTree(app), manifest_sha256: hash(fs.readFileSync(manifestFile)),
    binding_sha256: hash(bindingBytes), timezone: manifest.timezone, expected_scenarios: manifest.scenarios.length,
    interface: { load: 'Infra env.load_seed', query: 'Agent stayready.inspect', verify: 'Infra env.snapshot' },
    scenarios: [], passed: false };
  let prepared;
  const clients = [];
  try {
    prepared = prepare(app);
    const options = { registry: prepared.registry, initialProfile: 'sandbox' };
    const infra = new Client('stayready', 'infra', 'dataset-coverage', path.join(prepared.root, 'state'), 'stayready-dataset-evidence', options);
    const agent = new Client('stayready', 'agent', 'dataset-coverage', path.join(prepared.root, 'state'), 'stayready-dataset-evidence', { registry: prepared.registry });
    clients.push(infra, agent);
    await infra.initialize(); await agent.initialize();
    assert((await agent.request('tools/list')).result.tools.some(t => t.name === 'stayready.inspect'));
    for (const entry of manifest.scenarios) {
      const seedBytes = fs.readFileSync(path.join(app, 'datasets', entry.file));
      assert.equal(hash(seedBytes), entry.sha256);
      const seed = JSON.parse(seedBytes);
      const before = await infra.call('env.snapshot');
      const requestId = 'load-' + entry.scenario_id;
      const loadArgs = { expected_version: before.version, request_id: requestId, data: seed, binding, virtual_now: entry.initial_time };
      const loadResult = await infra.call('env.load_seed', loadArgs);
      const row = { scenario_id: entry.scenario_id, seed_file: 'datasets/' + entry.file, seed_sha256: entry.sha256,
        initial_time: entry.initial_time, load_request: { tool: 'env.load_seed', expected_version: before.version, request_id: requestId,
          data_file: 'datasets/' + entry.file, data_sha256: entry.sha256, binding_file: 'fixtures/binding.json', binding_sha256: report.binding_sha256, virtual_now: entry.initial_time },
        load_result: loadResult, passed: false };
      report.scenarios.push(row);
      assert.equal(loadResult.status, 'ready', entry.scenario_id + ': load');
      const snapshot = await infra.call('env.snapshot');
      assert.deepEqual(snapshot.snapshot.data, seed);
      assert.deepEqual(snapshot.snapshot.binding, binding);
      assert.equal(Date.parse(snapshot.snapshot.virtual_now), Date.parse(entry.initial_time));
      const inspected = await agent.call('stayready.inspect');
      assert.equal(inspected.status, 'ok');
      const view = inspected.view;
      assert.equal(view.account_id, seed.account_id);
      assert.equal(view.owner_person_id, seed.owner_person_id);
      assert.deepEqual(view.property, seed.property);
      assert.deepEqual(view.stay, seed.stay);
      assert.equal(view.property.timezone,manifest.timezone);
      assert.deepEqual(view.requests,seed.requests,'Loaded requests and acknowledgment/final replies must be publicly retrievable.');
      assert.deepEqual(view.history,seed.history,'Loaded operation/event history must be publicly retrievable.');
      assert(view.requests.length>=2&&view.requests.length<=4);
      assert(view.requests.every(r=>r.replies.some(reply=>reply.outcome==='acknowledged')));
      for(const request of view.requests.filter(r=>r.status==='confirmed')) {
        const promise=view.commitments.find(c=>c.request_id===request.id);
        assert(promise,'Each confirmed service request retains its linked hotel promise.');
        assert.deepEqual(promise.terms,request.final_reply.terms);
        assert.equal(promise.confirmed_at,request.final_reply.at);
      }
      assert.equal(Date.parse(view.virtual_now), Date.parse(entry.initial_time));
      assert.deepEqual(counts(view), entry.record_counts);
      assert.deepEqual(view.sources.map(s => [s.id, s.observed_at]), seed.sources.map(s => [s.id, s.observed_at]));
      assert(!JSON.stringify(view).includes('private_background'), entry.scenario_id + ': source background must not be visible to Agent');
      for (const source of seed.sources) if (source.fields.private_background) assert(!JSON.stringify(view).includes(source.fields.private_background));
      const earliestOccurrence = seed.sources.map(s => s.observed_at).sort()[0];
      assert(view.sources.some(s => s.observed_at === earliestOccurrence));
      assert.equal(view.stay.check_out, entry.stay_check_out);
      assert.equal(view.stay.guest_person_ids.length, 2);
      if (entry.pattern === 'arrival-mismatch') {
        const need = view.needs.find(n => n.id === 'need-arrival');
        const promise = view.commitments.find(c => c.terms.service === 'late_arrival');
        assert(Date.parse(need.conditions.arrival_at) > Date.parse(promise.terms.arrival_window.end));
      } else if (entry.pattern === 'route-unavailable') {
        assert.equal(view.commitments.find(c => c.need_id === entry.focus_need_id).effective_status, 'unavailable');
      } else if (entry.pattern === 'breakfast-partial') {
        assert.equal(view.needs.find(n => n.id === entry.focus_need_id).conditions.morning_dates.length, 2);
        assert.equal(view.commitments.find(c => c.need_id === entry.focus_need_id).terms.morning_dates.length, 1);
      } else if (entry.pattern === 'guest-replaced') {
        assert.equal(view.needs.find(n => n.id === entry.focus_need_id).is_current, false);
        assert.equal(view.commitments.find(c => c.need_id === entry.focus_need_id).status, 'active');
      } else assert.fail('Unknown scenario pattern: ' + entry.pattern);
      const after = await infra.call('env.snapshot');
      assert.deepEqual(after.snapshot.data, snapshot.snapshot.data);
      assert.deepEqual(after.version, snapshot.version);
      Object.assign(row, { query: { tool: 'stayready.inspect', arguments: {}, status: inspected.status, version: inspected.version,
        view_sha256: digest(view), account_id: view.account_id, record_counts: counts(view),
        visible_dates: { earliest_source_observed_at: earliestOccurrence, stay_check_in: view.stay.check_in, stay_check_out: view.stay.check_out },
        private_background_visible: false,
        history_retrieval:{requests_equal_seed:true,history_equal_seed:true,request_count:view.requests.length,history_count:view.history.length,
          requests:view.requests.map(r=>({id:r.id,need_id:r.need_id,submitted_at:r.submitted_at,status:r.status,replies:r.replies.map(reply=>({event_id:reply.event_id,at:reply.at,outcome:reply.outcome})),confirmed_commitment_id:view.commitments.find(c=>c.request_id===r.id)?.id||null})),
          request_records_sha256:digest(view.requests),history_records_sha256:digest(view.history)},
        sources: view.sources.map(s => ({ id: s.id, version: s.version, fields: s.fields })),
        commitments: view.commitments.map(c => ({ id: c.id, terms: c.terms, effective_status: c.effective_status })) },
        persisted_data_sha256: digest(after.snapshot.data), read_mutated_state: false, passed: true });
    }
    assert.equal(report.scenarios.length, 96);
    report.checked_months = [...new Set(report.scenarios.map(s => s.scenario_id.slice(0, 7)))];
    assert.equal(report.checked_months.length, 24);
    report.loaded_history={requests:report.scenarios.reduce((n,s)=>n+s.query.history_retrieval.request_count,0),history_records:report.scenarios.reduce((n,s)=>n+s.query.history_retrieval.history_count,0),scenarios_with_history:report.scenarios.filter(s=>s.query.history_retrieval.history_count>0).length};
    assert.equal(report.loaded_history.scenarios_with_history,96);
    assert.equal(report.scenarios[0].query.visible_dates.earliest_source_observed_at.slice(0, 10), '2025-01-01');
    assert.equal(report.scenarios.at(-1).query.visible_dates.stay_check_out.slice(0, 10), '2026-12-31');
    report.passed = true;
  } catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
  finally {
    await Promise.allSettled(clients.map(client => client.close()));
    prepared?.cleanup(); report.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'dataset-mcp.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: report.passed, scenarios: report.scenarios.length,
    error: report.error, report: path.join(output, 'dataset-mcp.json') }, null, 2));
}
if (require.main === module) main();
module.exports = { main };
