'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare } = require('../../../runtime/prepare.cjs');
const { Client } = require('../../../runtime/client.cjs');

test('Public Agent/Infra MCP confirmation boundary with persisted readback, both target types, and negative cases', async () => {
  const prep = prepare(path.resolve(__dirname, '..'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-pr-mcp-'));
  let infra, agent;
  try {
    infra = new Client('personal-records', 'infra', 'mcp-boundary', stateDir, 'test-infra', { registry: prep.registry, initialProfile: 'scenario' });
    agent = new Client('personal-records', 'agent', 'mcp-boundary', stateDir, 'test-agent', { registry: prep.registry });
    await infra.initialize();
    await agent.initialize();

    const initial = await agent.call('personal-records.get_document', { id: 'doc_payslip_dec2026', include_claims: true });
    assert.equal(initial.status, 'ok');
    assert.equal(initial.item.verification_state, 'INFERRED');

    // 0. Negative: Empty or unsupported proposed_changes rejected before creating a proposal
    const emptyProp = await agent.call('personal-records.propose_update', {
      target_type: 'document_metadata',
      target_id: 'doc_payslip_dec2026',
      expected_target_version: 1,
      proposed_changes: {},
      rationale: 'Empty change should fail',
      expected_version: initial.version,
      request_id: 'agent-prop-empty'
    });
    assert.equal(emptyProp.status, 'invalid_arguments');

    // 1. Agent proposes a document_metadata update bound to target_state_hash + version 1
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
    assert.ok(/^[a-f0-9]{64}$/.test(prop.target_state_hash));

    // 2. Negative: Agent-only run cannot confirm its own proposal
    const denied = await agent.call('personal-records.confirm_update', {
      proposal_id: prop.proposal_id,
      decision: 'APPROVE',
      expected_proposal_hash: prop.proposal_hash,
      expected_target_version: 1,
      expected_target_state_hash: prop.target_state_hash,
      expected_version: prop.version,
      request_id: 'agent-confirm-denied'
    });
    assert.equal(denied.status, 'permission_denied');

    // 3. Negative: Unbound decision (missing hash/target_state_hash/version) rejected by events.schema.json
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
          expected_target_state_hash: prop.target_state_hash,
          decision: 'APPROVE'
        }
      }
    });
    assert.equal(mismatched.status, 'proposal_mismatch');
    assert.deepEqual((await infra.call('env.snapshot')).snapshot.data, snap1.snapshot.data);

    // 5. Authorized trusted Infra decision for document_metadata commits and persists
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
          expected_target_state_hash: prop.target_state_hash,
          decision: 'APPROVE'
        }
      }
    };
    const confirmed = await infra.call('env.apply_event', confirmArgs);
    assert.equal(confirmed.status, 'committed');

    // Persisted readback through Agent MCP
    const after = await agent.call('personal-records.get_document', { id: 'doc_payslip_dec2026', include_claims: true });
    assert.equal(after.item.title, 'Acme Robotics Payslip (Dec 2026 - Confirmed)');
    assert.equal(after.item.verification_state, 'USER_CONFIRMED');

    // 6. Replay protection: capture state BEFORE replay and verify replay leaves it identical
    const beforeReplay = await infra.call('env.snapshot');
    const dup = await infra.call('env.apply_event', confirmArgs);
    assert.equal(dup.duplicate, true);
    assert.deepEqual((await infra.call('env.snapshot')).snapshot.data, beforeReplay.snapshot.data);

    const replayNewId = await infra.call('env.apply_event', {
      expected_version: confirmed.version,
      event: {
        ...confirmArgs.event,
        event_id: 'evt_confirm_replay_2',
        at: '2026-11-19T09:15:00Z'
      }
    });
    assert.equal(replayNewId.status, 'invalid_state');
    assert.deepEqual((await infra.call('env.snapshot')).snapshot.data, beforeReplay.snapshot.data);

    // 7. Second supported target type ('claim'): authorized edit + persisted readback
    const claimProp = await agent.call('personal-records.propose_update', {
      target_type: 'claim',
      target_id: 'clm_dec_net_pay',
      expected_target_version: 1,
      proposed_changes: { claim_text: 'December 2026 net taxable pay confirmed at $6,600.00' },
      rationale: 'Confirm claim wording against payroll statement',
      expected_version: after.version,
      request_id: 'agent-claim-prop-1'
    });
    assert.equal(claimProp.status, 'committed');

    const claimConfirmed = await infra.call('env.apply_event', {
      expected_version: claimProp.version,
      event: {
        event_id: 'evt_confirm_claim_1',
        at: '2026-11-19T09:18:00Z',
        operation: 'personal-records.confirm_decision',
        payload: {
          proposal_id: claimProp.proposal_id,
          expected_proposal_hash: claimProp.proposal_hash,
          expected_target_version: 1,
          expected_target_state_hash: claimProp.target_state_hash,
          decision: 'APPROVE'
        }
      }
    });
    assert.equal(claimConfirmed.status, 'committed');

    const afterClaim = await agent.call('personal-records.get_document', { id: 'doc_payslip_dec2026', include_claims: true });
    const updatedClaim = afterClaim.item.claims.find(c => c.id === 'clm_dec_net_pay');
    assert.equal(updatedClaim.claim_text, 'December 2026 net taxable pay confirmed at $6,600.00');
    assert.equal(updatedClaim.verification_state, 'USER_CONFIRMED');

    // 8. Negative: Stale target_state_hash when editable metadata changes while proposal is pending
    const propA = await agent.call('personal-records.propose_update', {
      target_type: 'document_metadata',
      target_id: 'doc_payslip_nov2026',
      expected_target_version: 1,
      proposed_changes: { title: 'Nov Payslip Edit A' },
      rationale: 'Concurrent edit A',
      expected_version: afterClaim.version,
      request_id: 'agent-prop-a'
    });
    const propB = await agent.call('personal-records.propose_update', {
      target_type: 'document_metadata',
      target_id: 'doc_payslip_nov2026',
      expected_target_version: 1,
      proposed_changes: { title: 'Nov Payslip Edit B' },
      rationale: 'Concurrent edit B',
      expected_version: propA.version,
      request_id: 'agent-prop-b'
    });
    const winA = await infra.call('env.apply_event', {
      expected_version: propB.version,
      event: {
        event_id: 'evt_confirm_a',
        at: '2026-11-19T09:20:00Z',
        operation: 'personal-records.confirm_decision',
        payload: {
          proposal_id: propA.proposal_id,
          expected_proposal_hash: propA.proposal_hash,
          expected_target_version: 1,
          expected_target_state_hash: propA.target_state_hash,
          decision: 'APPROVE'
        }
      }
    });
    assert.equal(winA.status, 'committed');

    // Now propB has same document content version (1), but editable metadata state changed!
    const staleB = await infra.call('env.apply_event', {
      expected_version: winA.version,
      event: {
        event_id: 'evt_confirm_b_stale',
        at: '2026-11-19T09:21:00Z',
        operation: 'personal-records.confirm_decision',
        payload: {
          proposal_id: propB.proposal_id,
          expected_proposal_hash: propB.proposal_hash,
          expected_target_version: 1,
          expected_target_state_hash: propB.target_state_hash,
          decision: 'APPROVE'
        }
      }
    });
    assert.equal(staleB.status, 'stale_proposal_version');
    const novAfter = await agent.call('personal-records.get_document', { id: 'doc_payslip_nov2026' });
    assert.equal(novAfter.item.title, 'Nov Payslip Edit A');
  } finally {
    await Promise.allSettled([infra?.close(), agent?.close()]);
    prep.cleanup();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
