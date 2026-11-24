'use strict';
const path = require('node:path'), assert = require('node:assert/strict');
const runtime = path.resolve(process.env.PALE_RUNTIME_ROOT || path.join(__dirname, '../../..', 'runtime'));
const {prepare} = require(path.join(runtime, 'prepare.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const {args} = require('../tests/support.cjs');

async function run() {
  const prepared = prepare(path.resolve(__dirname, '..')), clients = [], steps = [];
  const connect = async role => {
    const c = new Client('finance', role, 'transfer-demo', path.join(prepared.root, 'state'),
      'finance-transfer-demo', {registry: prepared.registry});
    clients.push(c); await c.initialize(); return c;
  };
  const call = async (client, name, args) => {
    const result = await client.call(name, args);
    steps.push({tool: name, result});
    return result;
  };
  try {
    let agent = await connect('agent');
    const infra = await connect('infra');
    const before = await call(agent, 'finance.accounts.list', {});
    assert.equal(before.status, 'ok');
    const preview = await call(agent, 'finance.actions.preview', {...args,
      request_id: 'preview-transfer-001', expected_version: before.version});
    assert.equal(preview.status, 'committed');
    const p = preview.proposal;
    const denied = await call(agent, 'finance.actions.execute', {id: p.id,
      request_id: 'unapproved-execution', expected_version: preview.version});
    assert.equal(denied.status, 'approval_required');
    const decision = await call(infra, 'env.apply_event', {expected_version: preview.version, event: {
      event_id: 'trusted-decision-001', at: p.created_at, operation: 'finance.decision_recorded', payload: {
        approval_id: 'approval-demo', proposal_id: p.id, proposal_revision: p.revision,
        decision: 'approve', expires_at: p.expires_at, source_ref: 'trusted-user-turn-2'}}});
    assert.equal(decision.status, 'committed');
    const current = await call(agent, 'finance.actions.get', {id: p.id});
    assert.equal(current.proposal.status, 'approved');
    const executeArgs = {id: p.id, request_id: 'execute-transfer-001', expected_version: current.version};
    const executed = await call(agent, 'finance.actions.execute', executeArgs);
    assert.equal(executed.status, 'committed');
    const replay = await call(agent, 'finance.actions.execute', executeArgs);
    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.receipt, executed.receipt);
    await agent.close();
    agent = await connect('agent');
    const receipt = await call(agent, 'finance.receipts.get', {id: executed.receipt.id});
    assert.deepEqual(receipt.receipt, executed.receipt);
    const after = await call(agent, 'finance.accounts.list', {});
    assert.equal(after.accounts.find(a => a.id === 'checking').balance_cents, 410000);
    assert.equal(after.accounts.find(a => a.id === 'investing').balance_cents, 310000);
    return {passed: true, run: 'transfer-demo', steps,
      checked: ['Actual Agent/Infra MCP connections', 'Unapproved execution denied',
        'Exact approved transfer committed', 'Original request replay deduplicated',
        'Fresh MCP process reads persisted receipt and balances']};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
if (require.main === module) run().then(report => console.log(JSON.stringify(report, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {run};
