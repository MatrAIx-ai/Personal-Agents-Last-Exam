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
const { PlatformManager } = require('../src/platform.cjs');

function setupTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-test-'));
  const db = createDatabase(':memory:');
  const blobStore = new BlobStore(tempDir);
  const extractionService = new ExtractionService();
  const docService = new DocumentService(db, blobStore, extractionService);
  const evidenceService = new EvidenceService(db);
  const platform = new PlatformManager(db, blobStore, docService, evidenceService);

  return { platform, docService, db, tempDir };
}

test('Platform seed, mutation, snapshot, and deterministic reset', () => {
  const { platform, docService, db, tempDir } = setupTest();
  try {
    const truthFixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../fixtures/truth.json'), 'utf-8')
    );

    // 1. Initial Seed
    const seedResult = platform.seed(truthFixture);
    assert.strictEqual(seedResult.status, 'SEEDED');
    assert.strictEqual(seedResult.documents_seeded, 2);

    // Check baseline document count
    const baselineDocs = docService.search({ accountId: 'acc_user_123' });
    assert.strictEqual(baselineDocs.length, 2);

    // 2. Perform a mutation (upload extra document)
    docService.uploadDocument({
      accountId: 'acc_user_123',
      title: 'Ephemeral Receipt',
      contentBytes: Buffer.from('Expense $45.00'),
      mimeType: 'text/plain'
    });

    const mutatedDocs = docService.search({ accountId: 'acc_user_123' });
    assert.strictEqual(mutatedDocs.length, 3);

    // 3. Snapshot verification
    const snapshot = platform.snapshot('acc_user_123');
    assert.strictEqual(snapshot.documents.length, 3);
    assert.strictEqual(snapshot.links.length, 1);

    // 4. Reset
    const resetResult = platform.reset('acc_user_123');
    assert.strictEqual(resetResult.status, 'RESET_COMPLETE');

    // 5. Assert exact baseline restored
    const restoredDocs = docService.search({ accountId: 'acc_user_123' });
    assert.strictEqual(restoredDocs.length, 2);
    const titles = restoredDocs.map((d) => d.title);
    assert.ok(titles.includes('Payslip November 2026'));
    assert.ok(titles.includes('Employment Contract'));
    assert.ok(!titles.includes('Ephemeral Receipt'));
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Idempotent operation execution', () => {
  const { platform, docService, db, tempDir } = setupTest();
  try {
    db.prepare("INSERT INTO accounts (account_id) VALUES ('acc_user_123')").run();

    let execCount = 0;
    const runOp = () => {
      return platform.executeIdempotent('acc_user_123', 'upload', 'idem_key_999', () => {
        execCount++;
        return docService.uploadDocument({
          accountId: 'acc_user_123',
          title: 'Idempotent Document',
          contentBytes: Buffer.from('Content bytes for idempotency test'),
          mimeType: 'text/plain'
        });
      });
    };

    // First call
    const res1 = runOp();
    assert.strictEqual(execCount, 1);

    // Second call with same idempotency key
    const res2 = runOp();
    assert.strictEqual(execCount, 1); // Should not have executed closure again
    assert.strictEqual(res1.document_id, res2.document_id);
    assert.strictEqual(res1.sha256, res2.sha256);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
