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
const { EventManager } = require('../src/events.cjs');
const { AppAdapters } = require('../src/adapters.cjs');

function setupTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-test-'));
  const db = createDatabase(':memory:');
  db.prepare("INSERT INTO accounts (account_id) VALUES ('acc_user_123')").run();

  const blobStore = new BlobStore(tempDir);
  const extractionService = new ExtractionService({
    hash_nov: {
      fallback_content: 'Nov payslip',
      fields: { net_pay: 4200, gross_pay: 5000 }
    },
    hash_dec: {
      fallback_content: 'Dec payslip',
      fields: { net_pay: 4500, gross_pay: 5300 }
    }
  });

  const docService = new DocumentService(db, blobStore, extractionService);
  const evidenceService = new EvidenceService(db);
  const eventManager = new EventManager(db, docService, evidenceService);

  return { eventManager, docService, evidenceService, db, tempDir };
}

test('Virtual time expiry rules and duplicate alert suppression', () => {
  const { eventManager, docService, db, tempDir } = setupTest();
  try {
    // Document expiring on 2026-12-10
    docService.uploadDocument({
      accountId: 'acc_user_123',
      title: 'Auto Insurance Policy',
      contentBytes: Buffer.from('Policy covers vehicle #4432'),
      mimeType: 'text/plain',
      validUntil: '2026-12-10T00:00:00Z'
    });

    // 1. Virtual time is 2026-11-01 (39 days away) -> Outside 30-day window -> No alert
    const noAlerts = eventManager.checkExpiries({
      accountId: 'acc_user_123',
      virtualNow: '2026-11-01T00:00:00Z',
      thresholdDays: 30
    });
    assert.strictEqual(noAlerts.length, 0);

    // 2. Virtual time advances to 2026-11-20 (20 days away) -> Inside 30-day window -> Alert dispatches
    const alerts = eventManager.checkExpiries({
      accountId: 'acc_user_123',
      virtualNow: '2026-11-20T00:00:00Z',
      thresholdDays: 30
    });
    assert.strictEqual(alerts.length, 1);
    assert.ok(alerts[0].subject.includes('Auto Insurance Policy'));

    // 3. Virtual time advances to 2026-11-22 (2 days later) -> Within 7-day suppression -> Suppressed
    const suppressed = eventManager.checkExpiries({
      accountId: 'acc_user_123',
      virtualNow: '2026-11-22T00:00:00Z',
      thresholdDays: 30,
      suppressDays: 7
    });
    assert.strictEqual(suppressed.length, 0);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Material discrepancy detection on successive payslips', () => {
  const { eventManager, docService, evidenceService, db, tempDir } = setupTest();
  try {
    const novDoc = docService.uploadDocument({
      accountId: 'acc_user_123',
      title: 'November Payslip',
      contentBytes: Buffer.from('nov_bytes'),
      mimeType: 'text/plain'
    });

    const decDoc = docService.uploadDocument({
      accountId: 'acc_user_123',
      title: 'December Payslip',
      contentBytes: Buffer.from('dec_bytes'),
      mimeType: 'text/plain'
    });

    // Manually inject mock numerical fields for discrepancy comparison
    db.prepare(`
      UPDATE extractions SET extracted_fields = ? WHERE document_id = ?
    `).run(JSON.stringify({ net_pay: 4200, gross_pay: 5000 }), novDoc.document_id);

    db.prepare(`
      UPDATE extractions SET extracted_fields = ? WHERE document_id = ?
    `).run(JSON.stringify({ net_pay: 4500, gross_pay: 5300 }), decDoc.document_id);

    // Link December supersedes November
    evidenceService.linkDocuments({
      accountId: 'acc_user_123',
      sourceId: decDoc.document_id,
      targetId: novDoc.document_id,
      relationshipType: 'supersedes'
    });

    // Check discrepancy
    const result = eventManager.checkDiscrepancies({
      accountId: 'acc_user_123',
      newerDocId: decDoc.document_id,
      olderDocId: novDoc.document_id
    });

    assert.strictEqual(result.flagged, true);
    assert.strictEqual(result.discrepancies.length, 2);
    const netPayDisc = result.discrepancies.find((d) => d.field === 'net_pay');
    assert.strictEqual(netPayDisc.delta, 300);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Outbound CloudEvent envelope generation conforms to schema', () => {
  const { eventManager, db, tempDir } = setupTest();
  try {
    const cloudEvent = eventManager.buildOutboundCloudEvent({
      id: 'evt_test_001',
      time: '2026-11-20T09:00:00Z',
      recipient: 'user@example.com',
      subject: 'Policy Renewal Reminder',
      bodyText: 'Your policy is up for renewal.'
    });

    assert.strictEqual(cloudEvent.specversion, '1.0');
    assert.strictEqual(cloudEvent.type, 'urn:pale:email-message:2');
    assert.strictEqual(cloudEvent.source, '/app/personal-records');
    assert.strictEqual(cloudEvent.data.recipient, 'user@example.com');
    assert.deepStrictEqual(cloudEvent.data.asset_ids, []);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('App read adapters: Mail and Files import contracts', async () => {
  const { eventManager, db, tempDir } = setupTest();
  try {
    // Mock Mail client adhering to mail.get and mail.attachment.get
    const mockMailClient = {
      get: async ({ id }) => ({ id, subject: 'Monthly Payslip' }),
      attachment: {
        get: async ({ id, asset_id }) => ({
          filename: 'payslip_oct.txt',
          mime_type: 'text/plain',
          content_bytes: Buffer.from('Monthly Net Pay: $4,200.00').toString('base64')
        })
      }
    };

    // Injected Mail event
    const envelope = {
      event_id: 'evt_inbound_01',
      at: '2026-11-20T10:00:00Z',
      operation: 'records.inject_document',
      payload: {
        source: 'mail_attachment',
        source_account: 'acc_user_123',
        message_id: 'msg_100',
        asset_id: 'asset_200'
      }
    };

    const injectedDoc = await eventManager.handleInjectedEvent(envelope, { mailClient: mockMailClient });
    assert.strictEqual(injectedDoc.version_number, 1);
    assert.strictEqual(injectedDoc.status, 'READY');

    // Missing source outcome verification
    const missingMailClient = {
      get: async () => null,
      attachment: {
        get: async () => null
      }
    };

    await assert.rejects(
      async () => {
        await eventManager.handleInjectedEvent(envelope, { mailClient: missingMailClient });
      },
      (err) => err.code === 'SOURCE_NOT_FOUND'
    );
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
