'use strict';
const fs = require('node:fs'), path = require('node:path');
const plugin = require('../plugin.cjs');
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
function fixture() {
  return {data: read('fixtures/minimal.json'), ctx: {binding: read('fixtures/binding.json'),
    role: 'agent', virtual_now: read('fixtures/clock.json').initial_time}};
}
const args = {kind: 'transfer', parameters: {from_account: 'checking', to_account: 'investing', amount_cents: 10000},
  reason: 'Move the specifically approved amount to my brokerage cash account.'};
function preview(f, parameters = args) {
  const out = plugin.handleTool(f.ctx, f.data, 'finance.actions.preview', structuredClone(parameters));
  f.data = out.data;
  return out.result.proposal;
}
function event(f, operation, payload) {
  f.data = plugin.applyEvent({...f.ctx, role: 'infra'}, f.data,
    {event_id: 'test-event', at: f.ctx.virtual_now, operation, payload});
}
function approve(f, p, decision = 'approve') {
  event(f, 'finance.decision_recorded', {approval_id: 'approval-' + p.id, proposal_id: p.id,
    proposal_revision: p.revision, decision, expires_at: p.expires_at, source_ref: 'trusted-user-turn-2'});
}
function execute(f, p) {
  const out = plugin.handleTool(f.ctx, f.data, 'finance.actions.execute', {id: p.id});
  f.data = out.data;
  return out.result.receipt;
}
module.exports = {plugin, fixture, args, preview, event, approve, execute};
