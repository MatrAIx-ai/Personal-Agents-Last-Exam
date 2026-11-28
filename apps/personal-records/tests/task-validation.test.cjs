/**
 * Milestone 5: End-to-End Task Integration Validation Suite
 * Simulates full benchmark agent trajectories and deterministic grading
 * for Task #102 (Tax Evidentiary Packet) and Task #106 (Employment Audit).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { PersonalRecordsApp } = require('../src/index.cjs');

function setupTaskHarness() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-val-'));
  const app = new PersonalRecordsApp({
    dbPath: ':memory:',
    blobDir: tempDir
  });

  const truthFixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../fixtures/truth.json'), 'utf-8')
  );

  app.seed(truthFixture);

  return { app, truthFixture, tempDir };
}

test('Milestone 5 - Task #102: Tax Evidentiary Packet Assembly', async () => {
  const { app, truthFixture, tempDir } = setupTaskHarness();
  const accountId = truthFixture.account_id;
  const agentCtx = { accountId, callerRole: 'agent' };

  try {
    // -------------------------------------------------------------
    // Step 1: Agent searches for tax return and supporting documents
    // -------------------------------------------------------------
    const taxReturns = await app.callTool('records.search', { category: 'tax' }, agentCtx);
    assert.ok(taxReturns.length >= 3, 'Agent must discover tax return and supporting receipts');

    const form1040 = taxReturns.find((d) => d.title.includes('Form 1040'));
    const w2Doc = taxReturns.find((d) => d.title.includes('Form W-2'));
    const donationReceipts = taxReturns.filter((d) => d.title.includes('Donation Tax Receipt'));

    assert.ok(form1040, 'Form 1040 must be found');
    assert.ok(w2Doc, 'Form W-2 must be found');
    assert.ok(donationReceipts.length >= 2, 'Donation receipts must be found');

    // -------------------------------------------------------------
    // Step 2: Agent reads document text to locate deduction and income figures
    // -------------------------------------------------------------
    const doc1040 = await app.callTool(
      'records.get_document',
      { document_id: form1040.document_id, include_extracted_text: true },
      agentCtx
    );
    const raw1040 = doc1040.extraction.raw_text;

    // Locate exact character offsets in 1040 for Refund Amount
    const refundPhrase = '$1,950.00';
    const refundStart = raw1040.indexOf(refundPhrase);
    const refundEnd = refundStart + refundPhrase.length;

    // Anchor factual claim to character span
    const claim1 = await app.callTool(
      'records.create_evidence_claim',
      {
        document_id: form1040.document_id,
        version_number: 1,
        extraction_revision: 'ext_rev_01',
        start_offset: refundStart,
        end_offset: refundEnd,
        cited_text: refundPhrase,
        claim_text: 'Federal refund claimed for 2025 is $1,950.00'
      },
      agentCtx
    );
    assert.strictEqual(claim1.verification_state, 'INFERRED');

    // -------------------------------------------------------------
    // Step 3: Agent links supporting receipts to Form 1040
    // -------------------------------------------------------------
    // Link W-2 -> 1040
    const w2Link = await app.callTool(
      'records.link_documents',
      {
        source_id: w2Doc.document_id,
        target_id: form1040.document_id,
        relationship_type: 'tax_supporting_document',
        metadata: { tax_year: 2025, form_type: 'W-2' }
      },
      agentCtx
    );
    assert.strictEqual(w2Link.relationship_type, 'tax_supporting_document');

    // Link donation receipts -> 1040
    for (const receipt of donationReceipts) {
      await app.callTool(
        'records.link_documents',
        {
          source_id: receipt.document_id,
          target_id: form1040.document_id,
          relationship_type: 'tax_supporting_document',
          metadata: { tax_year: 2025, schedule: 'Schedule A' }
        },
        agentCtx
      );
    }

    // -------------------------------------------------------------
    // Step 4: Deterministic Task Grader Verification
    // -------------------------------------------------------------
    const snapshot = app.snapshot(accountId);

    // Verify link graph contains all expected tax supporting links
    const taxLinks = snapshot.links.filter(
      (l) => l.target_id === form1040.document_id && l.relationship_type === 'tax_supporting_document'
    );
    assert.ok(
      taxLinks.length >= 3,
      `Tax evidentiary bundle must link W-2 and all receipts (found ${taxLinks.length})`
    );

    // Verify claim exists and matches byte-for-byte
    const claims = snapshot.claims.filter((c) => c.document_id === form1040.document_id);
    assert.strictEqual(claims.length, 1);
    assert.strictEqual(claims[0].cited_text, '$1,950.00');
  } finally {
    app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Milestone 5 - Task #106: Employment Compensation Audit & Discrepancy Resolution', async () => {
  const { app, truthFixture, tempDir } = setupTaskHarness();
  const accountId = truthFixture.account_id;
  const agentCtx = { accountId, callerRole: 'agent' };
  const userCtx = { accountId, callerRole: 'user' };

  try {
    // -------------------------------------------------------------
    // Step 1: Discover employment records (contract + successive payslips)
    // -------------------------------------------------------------
    const empDocs = await app.callTool('records.search', { category: 'employment' }, agentCtx);
    const contract = empDocs.find((d) => d.title.includes('Employment Agreement'));
    const novPayslip = empDocs.find((d) => d.title.includes('2026-11'));
    const decPayslip = empDocs.find((d) => d.title.includes('2026-12'));

    assert.ok(contract, 'Employment contract must exist');
    assert.ok(novPayslip, 'November payslip must exist');
    assert.ok(decPayslip, 'December payslip must exist');

    // -------------------------------------------------------------
    // Step 2: Establish supersedes link between December and November
    // -------------------------------------------------------------
    await app.callTool(
      'records.link_documents',
      {
        source_id: decPayslip.document_id,
        target_id: novPayslip.document_id,
        relationship_type: 'supersedes'
      },
      agentCtx
    );

    // -------------------------------------------------------------
    // Step 3: Run discrepancy check via EventManager
    // -------------------------------------------------------------
    // Inject mock numerical discrepancy between Dec and Nov
    app.db.prepare('UPDATE extractions SET extracted_fields = ? WHERE document_id = ?').run(
      JSON.stringify({ gross_pay: 10000.0, net_pay: 7800.0 }),
      novPayslip.document_id
    );
    app.db.prepare('UPDATE extractions SET extracted_fields = ? WHERE document_id = ?').run(
      JSON.stringify({ gross_pay: 10416.67, net_pay: 8125.0 }),
      decPayslip.document_id
    );

    const discResult = app.eventManager.checkDiscrepancies({
      accountId,
      newerDocId: decPayslip.document_id,
      olderDocId: novPayslip.document_id
    });

    assert.strictEqual(discResult.flagged, true);
    assert.strictEqual(discResult.discrepancies.length, 2);

    // -------------------------------------------------------------
    // Step 4: Agent stages proposal to update document metadata
    // -------------------------------------------------------------
    const proposalRes = await app.callTool(
      'records.propose_update',
      {
        target_type: 'document_metadata',
        target_id: decPayslip.document_id,
        expected_version: 1,
        proposed_changes: {
          title: 'Payslip 2026-12 - Merit Increase Applied',
          category: 'employment'
        },
        rationale: 'Reflects annual compensation adjustment noted in payroll variance'
      },
      agentCtx
    );

    assert.strictEqual(proposalRes.status, 'PENDING');

    // -------------------------------------------------------------
    // Step 5: Verify security boundary (Agent fails to approve)
    // -------------------------------------------------------------
    await assert.rejects(
      async () => {
        await app.callTool(
          'records.confirm_update',
          { proposal_id: proposalRes.proposal_id, decision: 'APPROVE' },
          agentCtx // Agent role prohibited
        );
      },
      (err) => err.code === 'PERMISSION_DENIED'
    );

    // -------------------------------------------------------------
    // Step 6: Trusted user confirms the proposal
    // -------------------------------------------------------------
    const confirmRes = await app.callTool(
      'records.confirm_update',
      { proposal_id: proposalRes.proposal_id, decision: 'APPROVE' },
      userCtx // Trusted user session
    );
    assert.strictEqual(confirmRes.status, 'APPROVED');

    // -------------------------------------------------------------
    // Step 7: Deterministic Grader Assertion
    // -------------------------------------------------------------
    const updatedDecDoc = await app.callTool(
      'records.get_document',
      { document_id: decPayslip.document_id },
      userCtx
    );

    assert.strictEqual(updatedDecDoc.title, 'Payslip 2026-12 - Merit Increase Applied');
    assert.strictEqual(updatedDecDoc.verification_state, 'USER_CONFIRMED');

    // Verify discrepancy notification was dispatched and stored in audit table
    const notifications = app.db
      .prepare('SELECT * FROM records_notifications WHERE account_id = ?')
      .all(accountId);
    assert.ok(notifications.some((n) => n.notification_type === 'DISCREPANCY_FLAG'));
  } finally {
    app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
