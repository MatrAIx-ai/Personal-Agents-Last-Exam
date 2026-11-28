const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createDatabase } = require('../src/db.cjs');
const { BlobStore } = require('../src/blob-store.cjs');
const { ExtractionService } = require('../src/extraction.cjs');
const { DocumentService } = require('../src/document-service.cjs');
const { EvidenceService } = require('../src/evidence-service.cjs');

function setupTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
  const db = createDatabase(':memory:');
  db.prepare("INSERT INTO accounts (account_id) VALUES ('acc_user_123')").run();

  const blobStore = new BlobStore(tempDir);
  const extractionService = new ExtractionService();
  const docService = new DocumentService(db, blobStore, extractionService);
  const evidenceService = new EvidenceService(db);

  return { docService, evidenceService, db, tempDir };
}

test('Document links: creation and nonexistent target rejection', () => {
  const { docService, evidenceService, db, tempDir } = setupTest();
  try {
    const doc1 = docService.uploadDocument({
      accountId: 'acc_user_123',
      title: 'Tax Packet 2026',
      contentBytes: Buffer.from('Main tax filing document'),
      mimeType: 'text/plain',
      category: 'tax'
    });

    const doc2 = docService.uploadDocument({
      accountId: 'acc_user_123',
      title: 'W2 Wage Statement',
      contentBytes: Buffer.from('Employer reported wages: $60,000'),
      mimeType: 'text/plain',
      category: 'employment'
    });

    // Valid link
    const link = evidenceService.linkDocuments({
      accountId: 'acc_user_123',
      sourceId: doc2.document_id,
      targetId: doc1.document_id,
      relationshipType: 'tax_supporting_document',
      metadata: { year: 2026 }
    });
    assert.strictEqual(link.relationship_type, 'tax_supporting_document');

    // Missing target must fail with LINK_TARGET_NOT_FOUND
    assert.throws(() => {
      evidenceService.linkDocuments({
        accountId: 'acc_user_123',
        sourceId: doc1.document_id,
        targetId: 'nonexistent_doc',
        relationshipType: 'supersedes'
      });
    }, (err) => err.code === 'LINK_TARGET_NOT_FOUND');
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Evidence claims: offset validation and passage citation', () => {
  const { docService, evidenceService, db, tempDir } = setupTest();
  try {
    const text = 'Net Taxable Pay: $4,250.00 for December 2026.';
    const doc = docService.uploadDocument({
      accountId: 'acc_user_123',
      title: 'Payslip Dec 2026',
      contentBytes: Buffer.from(text),
      mimeType: 'text/plain',
      category: 'employment'
    });

    const start = text.indexOf('$4,250.00');
    const end = start + '$4,250.00'.length;

    // Valid claim matching exact character slice
    const claim = evidenceService.createEvidenceClaim({
      accountId: 'acc_user_123',
      documentId: doc.document_id,
      versionNumber: 1,
      extractionRevision: 'ext_rev_01',
      startOffset: start,
      endOffset: end,
      citedText: '$4,250.00',
      claimText: 'December net earnings equal $4,250.00'
    });

    assert.strictEqual(claim.verification_state, 'INFERRED');

    // Mismatched citedText must fail with INVALID_PASSAGE_REFERENCE
    assert.throws(() => {
      evidenceService.createEvidenceClaim({
        accountId: 'acc_user_123',
        documentId: doc.document_id,
        versionNumber: 1,
        extractionRevision: 'ext_rev_01',
        startOffset: start,
        endOffset: end,
        citedText: '$5,000.00', // Intentional mismatch
        claimText: 'False claim'
      });
    }, (err) => err.code === 'INVALID_PASSAGE_REFERENCE');
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Trusted confirmation security boundary', () => {
  const { docService, evidenceService, db, tempDir } = setupTest();
  try {
    const doc = docService.uploadDocument({
      accountId: 'acc_user_123',
      title: 'Original Title',
      contentBytes: Buffer.from('Contract text'),
      mimeType: 'text/plain'
    });

    // 1. Agent proposes update
    const prop = evidenceService.proposeUpdate({
      accountId: 'acc_user_123',
      callerRole: 'agent',
      targetType: 'document_metadata',
      targetId: doc.document_id,
      expectedVersion: 1,
      proposedChanges: { title: 'Updated Verified Title', category: 'legal' },
      rationale: 'Corrected document title based on clause 1'
    });

    assert.strictEqual(prop.status, 'PENDING');

    // Verify document was NOT modified yet
    const unconfirmedDoc = docService.getDocument({
      accountId: 'acc_user_123',
      documentId: doc.document_id
    });
    assert.strictEqual(unconfirmedDoc.title, 'Original Title');
    assert.strictEqual(unconfirmedDoc.verification_state, 'INFERRED');

    // 2. Agent tries to approve its own proposal -> must fail PERMISSION_DENIED
    assert.throws(() => {
      evidenceService.confirmUpdate({
        accountId: 'acc_user_123',
        callerRole: 'agent', // Agent caller prohibited
        proposalId: prop.proposal_id,
        decision: 'APPROVE'
      });
    }, (err) => err.code === 'PERMISSION_DENIED');

    // 3. User session approves proposal -> succeeds and updates state
    const confirmed = evidenceService.confirmUpdate({
      accountId: 'acc_user_123',
      callerRole: 'user', // Trusted user session
      proposalId: prop.proposal_id,
      decision: 'APPROVE'
    });
    assert.strictEqual(confirmed.status, 'APPROVED');

    // Verify document was updated and verified
    const confirmedDoc = docService.getDocument({
      accountId: 'acc_user_123',
      documentId: doc.document_id
    });
    assert.strictEqual(confirmedDoc.title, 'Updated Verified Title');
    assert.strictEqual(confirmedDoc.verification_state, 'USER_CONFIRMED');
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
