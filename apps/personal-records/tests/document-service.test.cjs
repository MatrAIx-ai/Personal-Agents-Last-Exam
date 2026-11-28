const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createDatabase } = require('../src/db.cjs');
const { BlobStore } = require('../src/blob-store.cjs');
const { ExtractionService } = require('../src/extraction.cjs');
const { DocumentService } = require('../src/document-service.cjs');

function setupTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'records-test-'));
  const db = createDatabase(':memory:');
  db.prepare("INSERT INTO accounts (account_id) VALUES ('acc_user_123')").run();

  const blobStore = new BlobStore(tempDir);
  const extractionService = new ExtractionService();
  const service = new DocumentService(db, blobStore, extractionService);

  return { service, db, tempDir };
}

test('uploadDocument, deduplication, versioning, and search', (t) => {
  const { service, db, tempDir } = setupTest();

  try {
    // 1. Upload initial document
    const res = service.uploadDocument({
      accountId: 'acc_user_123',
      title: 'Electricity Utility Bill',
      contentBytes: Buffer.from('Account: 98765. Total kilowatt hours: 450 kWh. Due in 15 days.'),
      mimeType: 'text/plain',
      category: 'utilities',
      tags: ['power', 'monthly']
    });

    assert.strictEqual(res.version_number, 1);
    assert.strictEqual(res.status, 'READY');

    // 2. Duplicate upload rejection
    assert.throws(() => {
      service.uploadDocument({
        accountId: 'acc_user_123',
        title: 'Electricity Bill Duplicate',
        contentBytes: Buffer.from('Account: 98765. Total kilowatt hours: 450 kWh. Due in 15 days.'),
        mimeType: 'text/plain'
      });
    }, (err) => err.code === 'DUPLICATE_DOCUMENT');

    // 3. Create version 2 with optimistic concurrency
    const v2 = service.createVersion({
      accountId: 'acc_user_123',
      documentId: res.document_id,
      contentBytes: Buffer.from('Account: 98765. Corrected kilowatt hours: 460 kWh.'),
      mimeType: 'text/plain',
      changeSummary: 'Meter reading correction',
      expectedParentVersion: 1
    });
    assert.strictEqual(v2.version_number, 2);

    // Stale version check
    assert.throws(() => {
      service.createVersion({
        accountId: 'acc_user_123',
        documentId: res.document_id,
        contentBytes: Buffer.from('Other bytes'),
        mimeType: 'text/plain',
        expectedParentVersion: 1 // Current is now 2
      });
    }, (err) => err.code === 'STALE_VERSION');

    // 4. Full-text search
    const searchResults = service.search({
      accountId: 'acc_user_123',
      query: 'Corrected'
    });

    assert.strictEqual(searchResults.length, 1);
    assert.strictEqual(searchResults[0].document_id, res.document_id);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
