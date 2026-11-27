'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');

test('search and get_document are read-only and return seeded records', () => {
  const f = fixture();
  const before = structuredClone(f.data);
  const res = f.call('personal-records.search', { query: 'Payslip' });
  assert.equal(res.total, 2);
  assert.deepEqual(f.data, before);

  const doc = f.call('personal-records.get_document', { id: 'doc_payslip_dec2026', include_claims: true, include_links: true });
  assert.equal(doc.item.id, 'doc_payslip_dec2026');
  assert.equal(doc.item.claims.length, 1);
  assert.equal(doc.item.links.length, 1);
  assert.deepEqual(f.data, before);
});

test('upload_document deduplicates by SHA-256 and create_version enforces optimistic lock', () => {
  const f = fixture();
  const bytes = Buffer.from('Utility Bill\nTotal Due: $88.50', 'utf8').toString('base64');
  const uploaded = f.call('personal-records.upload_document', {
    title: 'November Water Bill',
    content_bytes: bytes,
    mime_type: 'text/plain',
    category: 'utilities',
    tags: ['water']
  });
  assert.equal(uploaded.version_number, 1);

  assert.throws(() => {
    f.call('personal-records.upload_document', {
      title: 'Duplicate Water Bill',
      content_bytes: bytes,
      mime_type: 'text/plain',
      category: 'utilities'
    });
  }, err => err.code === 'duplicate_document');

  const v2Bytes = Buffer.from('Utility Bill Revised\nTotal Due: $92.00', 'utf8').toString('base64');
  const v2 = f.call('personal-records.create_version', {
    document_id: uploaded.document_id,
    content_bytes: v2Bytes,
    mime_type: 'text/plain',
    change_summary: 'Corrected meter reading',
    expected_parent_version: 1
  });
  assert.equal(v2.version_number, 2);

  assert.throws(() => {
    f.call('personal-records.create_version', {
      document_id: uploaded.document_id,
      content_bytes: v2Bytes,
      mime_type: 'text/plain',
      expected_parent_version: 1
    });
  }, err => err.code === 'stale_version');
});

test('link_documents and create_evidence_claim validate targets and passage offsets', () => {
  const f = fixture();
  assert.throws(() => {
    f.call('personal-records.link_documents', {
      source_id: 'doc_payslip_dec2026',
      target_id: 'nonexistent',
      relationship_type: 'tax_supporting_document'
    });
  }, err => err.code === 'link_target_not_found');

  assert.throws(() => {
    f.call('personal-records.create_evidence_claim', {
      document_id: 'doc_payslip_dec2026',
      version_number: 1,
      extraction_revision: 'ext_rev_01',
      start_offset: 0,
      end_offset: 10,
      cited_text: 'WRONG TEXT',
      claim_text: 'Invalid citation'
    });
  }, err => err.code === 'invalid_passage_reference');
});

test('propose_update and confirm_update bind to hash/version and reject stale or replayed decisions', () => {
  const f = fixture();
  const prop = f.call('personal-records.propose_update', {
    target_type: 'document_metadata',
    target_id: 'doc_payslip_dec2026',
    expected_target_version: 1,
    proposed_changes: { title: 'Acme Robotics Payslip (Dec 2026 - Verified)' },
    rationale: 'Standardize title'
  });
  assert.equal(prop.proposal_status, 'PENDING');
  assert.ok(/^[a-f0-9]{64}$/.test(prop.proposal_hash));

  // Negative case 1: mismatched proposal hash
  assert.throws(() => {
    f.call('personal-records.confirm_update', {
      proposal_id: prop.proposal_id,
      decision: 'APPROVE',
      expected_proposal_hash: '0'.repeat(64)
    });
  }, err => err.code === 'proposal_mismatch');

  // Negative case 2: stale target version after document version increments
  const staleProp = f.call('personal-records.propose_update', {
    target_type: 'document_metadata',
    target_id: 'doc_payslip_nov2026',
    expected_target_version: 1,
    proposed_changes: { title: 'Should fail stale' },
    rationale: 'Test stale version'
  });
  f.call('personal-records.create_version', {
    document_id: 'doc_payslip_nov2026',
    content_bytes: Buffer.from('Updated Nov Payslip', 'utf8').toString('base64'),
    mime_type: 'text/plain',
    expected_parent_version: 1
  });
  assert.throws(() => {
    f.call('personal-records.confirm_update', {
      proposal_id: staleProp.proposal_id,
      decision: 'APPROVE',
      expected_proposal_hash: staleProp.proposal_hash
    });
  }, err => err.code === 'stale_proposal_version');

  // Trusted confirmation via event path (personal-records.confirm_decision)
  f.event({
    event_id: 'evt_confirm_1',
    at: '2026-11-19T10:00:00Z',
    operation: 'personal-records.confirm_decision',
    payload: {
      proposal_id: prop.proposal_id,
      decision: 'APPROVE',
      expected_proposal_hash: prop.proposal_hash,
      expected_target_version: 1
    }
  });

  const doc = f.call('personal-records.get_document', { id: 'doc_payslip_dec2026' });
  assert.equal(doc.item.title, 'Acme Robotics Payslip (Dec 2026 - Verified)');
  assert.equal(doc.item.verification_state, 'USER_CONFIRMED');

  // Negative case 3: replayed decision on already-resolved proposal
  assert.throws(() => {
    f.call('personal-records.confirm_update', {
      proposal_id: prop.proposal_id,
      decision: 'APPROVE'
    });
  }, err => err.code === 'invalid_state');
});

test('check_expiries and check_discrepancies evaluate virtual time and numeric deltas', () => {
  const f = fixture();
  const exp1 = f.call('personal-records.check_expiries', { threshold_days: 30, suppress_days: 7 });
  assert.equal(exp1.dispatched.length, 1);
  assert.equal(exp1.dispatched[0].document_id, 'doc_auto_policy_2026');

  // Immediate re-check within 7 virtual days is suppressed
  const exp2 = f.call('personal-records.check_expiries', { threshold_days: 30, suppress_days: 7 });
  assert.equal(exp2.dispatched.length, 0);

  const disc = f.call('personal-records.check_discrepancies', {
    newer_document_id: 'doc_payslip_dec2026',
    older_document_id: 'doc_payslip_nov2026'
  });
  assert.equal(disc.flagged, true);
  assert.equal(disc.discrepancies[0].field, 'net_pay');
  assert.equal(disc.discrepancies[0].delta, -250);
});
