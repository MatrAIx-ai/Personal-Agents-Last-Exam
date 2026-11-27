'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare } = require('../../../runtime/prepare.cjs');
const { Client } = require('../../../runtime/client.cjs');

test('Public Agent/Infra MCP confirmation boundary with persisted readback and negative cases', async () => {
  const prep = prepare(path.resolve(__dirname, '..'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-pr-mcp-'));
  let infra, agent;
  try {
    infra = new Client('personal-records', 'infra', 'mcp-boundary', stateDir, 'test-infra', { registry: prep.registry, initialProfile: 'scenario' });
    agent = new Client('personal-records', 'agent', 'mcp-boundary', stateDir, 'test-agent', { registry: prep.registry });
    await infra.initialize();
    await agent.initialize();

    const initial = await agent.call('personal-records.get_document', { id: 'doc_payslip_dec2026' });
    assert.equal(initial.status, 'ok');
    assert.equal(initial.item.verification_state, 'INFERRED');

    // 1. Agent proposes an update bound to target version 1
    const prop = await agent.call('personal-records.propose_update', {
      target_type: 'document_metadata',
      target_id: 'doc_payslip_dec2026',
      expected_target_version: 1,
      proposed_changes: { title: 'Acme Robotics Payslip (Dec 2026 - Confirmed)' },
      rationale: 'Verified December payslip against payroll.',
      expected_version: initial.version,
      request_id: 'agent-prop-1'
    });
    assert.equal(prop.status, 'committed');
    assert.equal(prop.proposal_status, 'PENDING');
    assert.ok(/^[a-f0-9]{64}$/.test(prop.proposal_hash));

    // 2. Negative: Agent-only run cannot confirm its own proposal
    const denied = await agent.call('personal-records.confirm_update', {
      proposal_id: prop.proposal_id,
      decision: 'APPROVE',
      expected_proposal_hash: prop.proposal_hash,
      expected_target_version: 1,
      expected_version: prop.version,
      request_id: 'agent-confirm-denied'
    });
    assert.equal(denied.status, 'permission_denied');

    // 3. Negative: Unbound decision (missing hash/version) rejected by events.schema.json
    const snap1 = await infra.call('env.snapshot');
    const unbound = await infra.call('env.apply_event', {
      expected_version: snap1.version,
      event: {
        event_id: 'evt_unbound_1',
        at: '2026-11-19T09:00:00Z',
        operation: 'personal-records.confirm_decision',
        payload: { proposal_id: prop.proposal_id, decision: 'APPROVE' }
      }
    });
    assert.equal(unbound.status, 'invalid_arguments');

    // 4. Negative: Mismatched edit digest leaves state unchanged
    const mismatched = await infra.call('env.apply_event', {
      expected_version: snap1.version,
      event: {
        event_id: 'evt_mismatch_1',
        at: '2026-11-19T09:05:00Z',
        operation: 'personal-records.confirm_decision',
        payload: {
          proposal_id: prop.proposal_id,
          expected_proposal_hash: '0'.repeat(64),
          expected_target_version: 1,
          decision: 'APPROVE'
        }
      }
    });
    assert.equal(mismatched.status, 'proposal_mismatch');
    assert.deepEqual((await infra.call('env.snapshot')).snapshot.data, snap1.snapshot.data);

    // 5. Authorized trusted Infra decision commits and persists
    const confirmArgs = {
      expected_version: snap1.version,
      event: {
        event_id: 'evt_confirm_ok_1',
        at: '2026-11-19T09:10:00Z',
        operation: 'personal-records.confirm_decision',
        payload: {
          proposal_id: prop.proposal_id,
          expected_proposal_hash: prop.proposal_hash,
          expected_target_version: 1,
          decision: 'APPROVE'
        }
      }
    };
    const confirmed = await infra.call('env.apply_event', confirmArgs);
    assert.equal(confirmed.status, 'committed');

    // Persisted readback through Agent MCP
    const after = await agent.call('personal-records.get_document', { id: 'doc_payslip_dec2026' });
    assert.equal(after.item.title, 'Acme Robotics Payslip (Dec 2026 - Confirmed)');
    assert.equal(after.item.verification_state, 'USER_CONFIRMED');

    // 6. Replay protection: same event_id deduplicates; new event_id on resolved proposal is rejected
    const dup = await infra.call('env.apply_event', confirmArgs);
    assert.equal(dup.duplicate, true);
    const replayNewId = await infra.call('env.apply_event', {
      expected_version: confirmed.version,
      event: {
        ...confirmArgs.event,
        event_id: 'evt_confirm_replay_2',
        at: '2026-11-19T09:15:00Z'
      }
    });
    assert.equal(replayNewId.status, 'invalid_state');
    assert.deepEqual((await infra.call('env.snapshot')).snapshot.data, (await infra.call('env.snapshot')).snapshot.data);

    // 7. Negative: Stale target version after document version increments
    const prop2 = await agent.call('personal-records.propose_update', {
      target_type: 'document_metadata',
      target_id: 'doc_payslip_nov2026',
      expected_target_version: 1,
      proposed_changes: { title: 'Stale test' },
      rationale: 'Test stale target rejection',
      expected_version: after.version,
      request_id: 'agent-prop-2'
    });
    const v2 = await agent.call('personal-records.create_version', {
      document_id: 'doc_payslip_nov2026',
      content_bytes: Buffer.from('New Nov Payslip v2', 'utf8').toString('base64'),
      mime_type: 'text/plain',
      expected_parent_version: 1,
      expected_version: prop2.version,
      request_id: 'agent-v2-1'
    });
    const stale = await infra.call('env.apply_event', {
      expected_version: v2.version,
      event: {
        event_id: 'evt_confirm_stale_1',
        at: '2026-11-19T09:20:00Z',
        operation: 'personal-records.confirm_decision',
        payload: {
          proposal_id: prop2.proposal_id,
          expected_proposal_hash: prop2.proposal_hash,
          expected_target_version: 1,
          decision: 'APPROVE'
        }
      }
    });
    assert.equal(stale.status, 'stale_proposal_version');
    const novAfter = await agent.call('personal-records.get_document', { id: 'doc_payslip_nov2026' });
    assert.equal(novAfter.item.title, 'Acme Robotics Payslip (Nov 2026)');
  } finally {
    await Promise.allSettled([infra?.close(), agent?.close()]);
    prep.cleanup();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
