const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { PersonalRecordsApp } = require('../src/index.cjs');
const { AppAdapters } = require('../src/adapters.cjs');

function loadFixtures() {
  const fixturePath = path.join(__dirname, '../fixtures/peer-apps.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
}

function createMockClients(fixtures) {
  // Deep clone to test immutability
  const mailData = JSON.parse(JSON.stringify(fixtures.mail));
  const filesData = JSON.parse(JSON.stringify(fixtures.files));
  const contactsData = JSON.parse(JSON.stringify(fixtures.contacts));
  const calendarData = JSON.parse(JSON.stringify(fixtures.calendar));

  const mailClient = {
    get: async ({ id }) => {
      return mailData.messages.find((m) => m.id === id) || null;
    },
    attachment: {
      get: async ({ id, asset_id }) => {
        const msg = mailData.messages.find((m) => m.id === id);
        if (!msg) return null;
        return msg.attachments.find((a) => a.asset_id === asset_id) || null;
      }
    }
  };

  const filesClient = {
    read: async ({ id, number }) => {
      const file = filesData.files.find((f) => f.id === id);
      if (!file) return null;
      return file;
    }
  };

  const contactsClient = {
    list: async ({ query, include_inactive }) => {
      if (!query) return { contacts: contactsData };
      const q = query.toLowerCase();
      const matched = contactsData.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.organization.toLowerCase().includes(q) ||
          q.includes(c.name.toLowerCase()) ||
          q.includes(c.organization.toLowerCase())
      );
      return { contacts: matched };
    }
  };

  const calendarClient = {
    list: async ({ start, end }) => {
      return { events: calendarData };
    }
  };

  return {
    clients: { mailClient, filesClient, contactsClient, calendarClient },
    rawState: { mailData, filesData, contactsData, calendarData }
  };
}

test('Milestone 2: Mail Attachment Import Contract', async () => {
  const fixtures = loadFixtures();
  const { clients, rawState } = createMockClients(fixtures);
  const initialMailSnapshot = JSON.stringify(rawState.mailData);

  const imported = await AppAdapters.importMailAttachment({
    mailClient: clients.mailClient,
    messageId: 'msg_w2_2026',
    assetId: 'ast_w2_pdf'
  });

  // Verify bytes and metadata
  assert.strictEqual(imported.filename, 'W2_2026_AcmeCorp.txt');
  assert.strictEqual(imported.mimeType, 'text/plain');
  assert.strictEqual(imported.sourceReference.message_id, 'msg_w2_2026');
  assert.ok(imported.bytes.toString('utf-8').includes('Employer: ACME Corporation'));

  // Verify source immutability
  assert.strictEqual(
    JSON.stringify(rawState.mailData),
    initialMailSnapshot,
    'Source Mail data must remain strictly unaltered after import'
  );
});

test('Milestone 2: Files Import Contract with Version Resolution', async () => {
  const fixtures = loadFixtures();
  const { clients, rawState } = createMockClients(fixtures);
  const initialFilesSnapshot = JSON.stringify(rawState.filesData);

  const imported = await AppAdapters.importFile({
    filesClient: clients.filesClient,
    fileId: 'file_lease_agreement',
    versionNumber: 2
  });

  assert.strictEqual(imported.filename, 'Apartment_Lease_2026.txt');
  assert.strictEqual(imported.version, 2);
  assert.ok(imported.bytes.toString('utf-8').includes('Monthly Rent: $2,200.00'));

  // Verify source immutability
  assert.strictEqual(
    JSON.stringify(rawState.filesData),
    initialFilesSnapshot,
    'Source Files data must remain strictly unaltered after import'
  );
});

test('Milestone 2: Absent Source Error Outcomes', async () => {
  const fixtures = loadFixtures();
  const { clients } = createMockClients(fixtures);

  // Missing Mail Message
  await assert.rejects(
    async () => {
      await AppAdapters.importMailAttachment({
        mailClient: clients.mailClient,
        messageId: 'nonexistent_msg',
        assetId: 'ast_w2_pdf'
      });
    },
    (err) => err.code === 'SOURCE_NOT_FOUND'
  );

  // Missing File
  await assert.rejects(
    async () => {
      await AppAdapters.importFile({
        filesClient: clients.filesClient,
        fileId: 'nonexistent_file'
      });
    },
    (err) => err.code === 'SOURCE_NOT_FOUND'
  );
});

test('Milestone 2: Contacts Entity Matching', async () => {
  const fixtures = loadFixtures();
  const { clients } = createMockClients(fixtures);

  // Match ACME Corporation from document title query
  const matched = await AppAdapters.matchContact({
    contactsClient: clients.contactsClient,
    query: 'ACME Corporation'
  });

  assert.ok(matched);
  assert.strictEqual(matched.contact_id, 'con_acme_corp');
  assert.strictEqual(matched.email, 'payroll@acmecorp.com');

  // Non-matching query returns null gracefully
  const unmatched = await AppAdapters.matchContact({
    contactsClient: clients.contactsClient,
    query: 'Unknown Third Party Ltd'
  });
  assert.strictEqual(unmatched, null);
});

test('Milestone 2: Calendar Deadline Correlation', async () => {
  const fixtures = loadFixtures();
  const { clients } = createMockClients(fixtures);

  // Correlation for Lease Renewal (should find the fixture event on 2027-05-01)
  const correlation = await AppAdapters.correlateCalendar({
    calendarClient: clients.calendarClient,
    targetDate: '2027-05-01T00:00:00Z',
    titleHint: 'Lease Renewal'
  });

  assert.strictEqual(correlation.scheduled, true);
  assert.strictEqual(correlation.matched_events.length, 1);
  assert.strictEqual(correlation.matched_events[0].event_id, 'evt_lease_renewal_reminder');

  // Check an unrepresented deadline (e.g. Tax Filing in April 2027)
  const unrepresented = await AppAdapters.correlateCalendar({
    calendarClient: clients.calendarClient,
    targetDate: '2027-04-15T00:00:00Z',
    titleHint: 'IRS Tax Return Filing'
  });
  assert.strictEqual(unrepresented.scheduled, false);
});

test('Milestone 2: Outbound CloudEvent Notification Routing', async () => {
  let dispatchedEvent = null;
  const mockMessagingRouter = {
    applyEvent: async (event) => {
      dispatchedEvent = event;
      return { status: 'DELIVERED', receipt_id: 'rcpt_001' };
    }
  };

  const res = await AppAdapters.dispatchNotification({
    messagingRouter: mockMessagingRouter,
    recipient: 'user@example.com',
    subject: 'Lease Renewal Notice',
    bodyText: 'Your lease requires renewal.'
  });

  assert.strictEqual(res.status, 'DISPATCHED');
  assert.ok(dispatchedEvent);
  assert.strictEqual(dispatchedEvent.specversion, '1.0');
  assert.strictEqual(dispatchedEvent.type, 'urn:pale:email-message:2');
  assert.strictEqual(dispatchedEvent.data.recipient, 'user@example.com');
  assert.deepStrictEqual(dispatchedEvent.data.asset_ids, []);
});

test('Milestone 2: End-to-End import_from_source tool with Contact Tagging', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-integ-'));
  const app = new PersonalRecordsApp({ dbPath: ':memory:', blobDir: tempDir });
  const fixtures = loadFixtures();
  const { clients } = createMockClients(fixtures);

  try {
    const importRes = await app.callTool(
      'records.import_from_source',
      {
        source_app: 'mail',
        title: 'ACME Corporation Wage Form W2',
        mail_params: { id: 'msg_w2_2026', asset_id: 'ast_w2_pdf' },
        category: 'employment'
      },
      {
        accountId: 'acc_demo_user',
        callerRole: 'agent',
        adapters: clients
      }
    );

    assert.strictEqual(importRes.version_number, 1);
    assert.strictEqual(importRes.status, 'READY');

    // Verify contact tag was linked automatically
    const doc = await app.callTool(
      'records.get_document',
      { document_id: importRes.document_id },
      { accountId: 'acc_demo_user' }
    );

    assert.ok(doc.tags.includes('contact:con_acme_corp'));
    assert.ok(doc.extraction.raw_text.includes('Total Wages: $75,000.00'));
  } finally {
    app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
