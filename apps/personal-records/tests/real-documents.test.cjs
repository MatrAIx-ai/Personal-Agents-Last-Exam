const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { PersonalRecordsApp } = require('../src/index.cjs');

// Helper 1: Generate a minimal valid binary PDF 1.4 file
function createValidPdfBinary(textContent) {
  const stream = `BT /F1 12 Tf 72 712 Td (${textContent}) Tj ET`;
  const pdfData = 
`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000334 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
407
%%EOF`;
  return Buffer.from(pdfData, 'binary');
}

// Helper 2: Minimal valid 1x1 pixel binary PNG
function createValidPngBinary() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
}

test('Real Binary Document Ingestion, Byte Preservation & Extraction', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'records-real-docs-'));

  // 1. Create real PDF and PNG binary buffers
  const pdfBytes = createValidPdfBinary('Official Pay Summary: Net Pay $8,125.00');
  const pngBytes = createValidPngBinary();

  const pdfSha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');
  const pngSha256 = crypto.createHash('sha256').update(pngBytes).digest('hex');

  // 2. Set up fallback manifest for deterministic extraction of the PDF
  const fallbackManifest = {
    [pdfSha256]: {
      fallback_content: 'Official Pay Summary: Net Pay $8,125.00',
      fields: { net_pay: 8125.0 }
    }
  };

  const app = new PersonalRecordsApp({
    dbPath: ':memory:',
    blobDir: tempDir,
    fallbackManifest
  });

  const accountId = 'acc_real_user';
  const ctx = { accountId, callerRole: 'agent' };

  try {
    // -----------------------------------------------------------
    // Step A: Upload Real Binary PDF
    // -----------------------------------------------------------
    const pdfUpload = await app.callTool('records.upload_document', {
      title: 'Real Payslip Document.pdf',
      content_bytes: pdfBytes.toString('base64'),
      mime_type: 'application/pdf',
      category: 'employment',
      tags: ['binary', 'pdf']
    }, ctx);

    assert.strictEqual(pdfUpload.version_number, 1);
    assert.strictEqual(pdfUpload.sha256, pdfSha256);
    // Because fallbackManifest matched the sha256, it immediately transitions to READY
    assert.strictEqual(pdfUpload.status, 'READY');

    // Verify Byte-Level Preservation: Read binary file directly from disk
    const docMeta = await app.callTool('records.get_document', {
      document_id: pdfUpload.document_id,
      include_extracted_text: true
    }, ctx);

    const savedBlobBytes = app.blobStore.readBytes(docMeta.version.blob_path);
    assert.strictEqual(
      Buffer.compare(savedBlobBytes, pdfBytes),
      0,
      'Saved PDF bytes on disk must match original binary input byte-for-byte'
    );

    // Verify FTS5 indexing on extracted fallback text
    const searchRes = await app.callTool('records.search', { query: '$8,125.00' }, ctx);
    assert.strictEqual(searchRes.length, 1);
    assert.strictEqual(searchRes[0].document_id, pdfUpload.document_id);

    // -----------------------------------------------------------
    // Step B: Upload Real Binary Image (PNG without fallback)
    // -----------------------------------------------------------
    const pngUpload = await app.callTool('records.upload_document', {
      title: 'Scanned Receipt.png',
      content_bytes: pngBytes.toString('base64'),
      mime_type: 'image/png',
      category: 'utilities'
    }, ctx);

    // Without OCR/fallback, raw images enter PARSING (DEFERRED_RAW) state
    assert.strictEqual(pngUpload.status, 'PARSING');

    const pngMeta = await app.callTool('records.get_document', {
      document_id: pngUpload.document_id
    }, ctx);

    const savedPngBytes = app.blobStore.readBytes(pngMeta.version.blob_path);
    assert.strictEqual(
      Buffer.compare(savedPngBytes, pngBytes),
      0,
      'Saved PNG bytes on disk must match original binary input byte-for-byte'
    );
  } finally {
    app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
