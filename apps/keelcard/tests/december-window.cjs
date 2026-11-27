'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('December staged events settle through stmt-2026-12', () => {
  const pkg = path.resolve(__dirname, '..');
  const root = path.resolve(pkg, '../..');
  const { createRuntime } = require(path.join(root, 'runtime/core/runtime.cjs'));
  const model = createRuntime({ registryFile: path.join(root, 'apps.registry.json') });
  const data = require(path.join(pkg, 'fixtures/freelancer.json'));
  const events = require(path.join(pkg, 'examples/events/freelancer-2026-12.json'));
  let state = model.create('keelcard', 'dec-window', 'sandbox');
  const loaded = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'dec-load',
    data,
    binding: require(path.join(pkg, 'fixtures/freelancer-binding.json')),
    policies: require(path.join(pkg, 'fixtures/policies.json')),
    virtual_now: data.initial_clock
  });
  assert.equal(loaded.result.status, 'ready');
  state = loaded.state;
  events.forEach((event, index) => {
    const advanced = model.execute(state, 'infra', 'env.advance_time', {
      expected_version: model.version(state),
      request_id: 'dec-adv-' + index,
      virtual_now: event.at
    });
    assert.equal(advanced.result.status, 'committed');
    state = advanced.state;
    const applied = model.execute(state, 'infra', 'env.apply_event', {
      expected_version: model.version(state),
      event
    });
    assert.equal(applied.result.status, 'committed', event.event_id);
    state = applied.state;
  });
  const transactions = model.execute(state, 'agent', 'keelcard.transactions.list', {}).result.transactions;
  const declines = model.execute(state, 'agent', 'keelcard.declines.list', {}).result.declines;
  const statements = model.execute(state, 'agent', 'keelcard.statements.list', {}).result.statements;
  assert.equal(transactions.length, 531);
  assert.equal(declines.length, 38);
  assert.deepEqual(statements.slice(-3).map(statement => statement.statement_id), ['stmt-2026-10', 'stmt-2026-11', 'stmt-2026-12']);
  assert.equal(state.virtual_now, '2027-01-01T00:05:00-05:00');
});

test('a mutated December file fails the committed load check and provenance stays on the partition', () => {
  const { loadQueries } = require('../examples/coverage-report.cjs');
  const shipped = loadQueries({ runId: 'shipped-check' });
  assert.equal(shipped.ok, true);
  assert.equal(shipped.stages.a.provenance.source_id, 'authored');
  assert.equal(shipped.stages.a.provenance.kind, 'synthetic');
  assert.equal(shipped.stages.a.provenance.records, 2);
  assert.equal(shipped.stages.b.provenance.source_id, 'freelancer');
  assert.equal(shipped.stages.b.provenance.kind, 'synthetic');
  assert.equal(shipped.stages.b.provenance.records, 6);
  assert.equal(shipped.stages.b.provenance.dataset_id, 'keelcard-minimal');
  assert.equal(shipped.stages.b_after_december.provenance.source_id, 'freelancer');
  assert.equal(shipped.stages.b_after_december.transactions, 531);
  assert.equal(shipped.stages.b_after_december.declines, 38);
  assert.equal(shipped.stages.b.provenance.description.includes('6 cards'), true);
  assert.equal(shipped.stages.b.provenance.description.includes('two household cards'), false);
  assert.equal(shipped.stages.a.provenance.description.includes('2 cards'), true);
  assert.equal(shipped.stages.b_after_december.statements, 24);
  assert.deepEqual(shipped.stages.b_after_december.last_statements, ['stmt-2026-10', 'stmt-2026-11', 'stmt-2026-12']);
  const events = structuredClone(require('../examples/events/freelancer-2026-12.json'));
  events.find(event => event.operation === 'authorization.capture').payload.amount_cents += 1;
  const mutated = loadQueries({ events, runId: 'mutated-check' });
  assert.equal(mutated.ok, false);
  assert.equal(mutated.stages.b_after_december.committed['authorization.capture'], 22);
  assert.equal(mutated.stages.b_after_december.capture_delta, 22);
  assert.equal(mutated.stages.b_after_december.denies.some(row => row.reason === 'amount_exceeds_hold'), true);
  assert.equal(mutated.stages.b_after_december.problems.some(problem => problem.includes('Capture amount is above the hold.')), true);
});

test('a December file without the settle fails the load check', () => {
  const { loadQueries } = require('../examples/coverage-report.cjs');
  const events = require('../examples/events/freelancer-2026-12.json').filter(event => event.event_id !== 'b-settle-2027-01');
  const opened = loadQueries({ events, runId: 'missing-settle' });
  assert.equal(opened.ok, false);
  assert.equal(opened.stages.b_after_december.committed['authorization.request'], 24);
  assert.equal(opened.stages.b_after_december.committed['authorization.capture'], 23);
  assert.equal(opened.stages.b_after_december.statement_delta, 0);
  assert.deepEqual(opened.stages.b_after_december.last_statements, ['stmt-2026-08', 'stmt-2026-09', 'stmt-2026-10']);
  const problems = opened.stages.b_after_december.problems.join('\n');
  assert.equal(problems.includes('missing December statements stmt-2026-11, stmt-2026-12'), true);
  assert.equal(problems.includes('missing December settle at 2027-01-01T00:05:00-05:00'), true);
});

test('duplicate receipts and a reused authorization payload fail the load check', () => {
  const { loadQueries } = require('../examples/coverage-report.cjs');
  const events = structuredClone(require('../examples/events/freelancer-2026-12.json'));
  const settle = events.pop();
  const capture = events.find(event => event.event_id === 'b-dec-cap-24');
  const request = events.find(event => event.event_id === 'b-dec-req-24');
  const again = structuredClone(request);
  again.event_id = 'b-dec-req-24-again';
  again.at = '2026-12-30T12:00:00.000Z';
  const captureAt = events.findIndex(event => event.event_id === 'b-dec-cap-24');
  events.splice(captureAt + 1, 0, structuredClone(capture));
  events.push(again);
  events.push(settle);
  const loaded = loadQueries({ events, runId: 'duplicate-check' });
  assert.equal(loaded.ok, false);
  assert.equal(loaded.stages.b_after_december.capture_delta, 23);
  assert.equal(loaded.stages.b_after_december.approved_delta, 23);
  const problems = loaded.stages.b_after_december.problems.join('\n');
  assert.equal(problems.includes('b-dec-cap-24 duplicate receipt'), true);
  assert.equal(problems.includes('b-dec-req-24-again did not add a distinct authorization'), true);
});

test('denied account reads fail the load check', () => {
  const { loadQueries } = require('../examples/coverage-report.cjs');
  const policies = structuredClone(require('../fixtures/policies.json'));
  const hidden = ['keelcard.transactions.list', 'keelcard.declines.list', 'keelcard.statements.list'];
  for (const profile of ['scenario', 'sandbox']) {
    policies[profile].allow = policies[profile].allow.filter(name => !hidden.includes(name));
  }
  const denied = loadQueries({ policies, runId: 'denied-reads' });
  assert.equal(denied.ok, false);
  assert.equal(denied.stages.b_after_december.approved_delta, null);
  assert.equal(denied.stages.b_after_december.transactions, null);
  const problems = denied.stages.b_after_december.problems.join('\n');
  assert.equal(problems.includes('a keelcard.transactions.list permission_denied'), true);
  assert.equal(problems.includes('b keelcard.declines.list permission_denied'), true);
  assert.equal(problems.includes('b_after_december keelcard.statements.list permission_denied'), true);
});
