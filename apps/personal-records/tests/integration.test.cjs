const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { PersonalRecordsApp } = require('../src/index.cjs');

function setupIntegrationApp() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'records-integ-'));
  const app = new PersonalRecordsApp({
    dbPath: ':memory:',
    blobDir: tempDir
  });

  return { app, tempDir };
}

test('End-to-end integration via callTool router', async () => {
  const { app, tempDir } = setupIntegrationApp();
  const context = { accountId: 'acc_demo_user', callerRole: 'agent' };

  try {
    // 1. Seed baseline scenario
    const truthFixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../fixtures/truth.json'), 'utf-8')
    );
    app.seed(truthFixture);

    // 2. Agent uploads an employment contract (Base64 payload)
    const contractBytes = Buffer.from('Employment Contract. Confidential salary: $75,000 annually.').toString('base64');
    const uploadRes = await app.callTool(
      'records.upload_document',
      {
        title: 'TechCorp Employment Contract',
        content_bytes: contractBytes,
        mime_type: 'text/plain',
        category: 'employment',
        tags: ['career', 'techcorp']
      },
      context
    );

    assert.strictEqual(uploadRes.version_number, 1);
    assert.strictEqual(uploadRes.status, 'READY');
    const docId = uploadRes.document_id;

    // 3. Agent searches for the document via FTS5
    const searchRes = await app.callTool(
      'records.search',
      { query: 'Confidential salary' },
      context
    );
    assert.strictEqual(searchRes.length, 1);
    assert.strictEqual(searchRes[0].document_id, docId);

    // 4. Agent creates an evidence claim referencing the exact text
    const textSnippet = 'salary: $75,000 annually.';
    const fullText = 'Employment Contract. Confidential salary: $75,000 annually.';
    const start = fullText.indexOf(textSnippet);
    const end = start + textSnippet.length;

    const claimRes = await app.callTool(
      'records.create_evidence_claim',
      {
        document_id: docId,
        version_number: 1,
        extraction_revision: 'ext_rev_01',
        start_offset: start,
        end_offset: end,
        cited_text: textSnippet,
        claim_text: 'Annual compensation is confirmed at $75,000'
      },
      context
    );
    assert.strictEqual(claimRes.verification_state, 'INFERRED');

    // 5. Agent proposes a title change
    const propRes = await app.callTool(
      'records.propose_update',
      {
        target_type: 'document_metadata',
        target_id: docId,
        expected_version: 1,
        proposed_changes: { title: 'Verified TechCorp Contract 2026' },
        rationale: 'Formalized title according to company naming policy'
      },
      context
    );
    assert.strictEqual(propRes.status, 'PENDING');

    // 6. Agent tries to confirm its own proposal -> must fail PERMISSION_DENIED
    await assert.rejects(
      async () => {
        await app.callTool(
          'records.confirm_update',
          { proposal_id: propRes.proposal_id, decision: 'APPROVE' },
          { ...context, callerRole: 'agent' }
        );
      },
      (err) => err.code === 'PERMISSION_DENIED'
    );

    // 7. Human user approves proposal
    const confirmRes = await app.callTool(
      'records.confirm_update',
      { proposal_id: propRes.proposal_id, decision: 'APPROVE' },
      { ...context, callerRole: 'user' } // Trusted user session
    );
    assert.strictEqual(confirmRes.status, 'APPROVED');

    // 8. Verify the updated document has verification_state = USER_CONFIRMED
    const docData = await app.callTool(
      'records.get_document',
      { document_id: docId, include_claims: true },
      context
    );
    assert.strictEqual(docData.title, 'Verified TechCorp Contract 2026');
    assert.strictEqual(docData.verification_state, 'USER_CONFIRMED');
    assert.strictEqual(docData.claims.length, 1);
  } finally {
    app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
