// apps/personal-records/scripts/test-local-file.cjs
const fs = require('fs');
const path = require('path');
const { PersonalRecordsApp } = require('../src/index.cjs');

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(filePath)) {
  console.error('\nUsage: node scripts/test-local-file.cjs <path-to-real-file>');
  console.error('Example: node scripts/test-local-file.cjs ~/Downloads/technical_study_notes.pdf\n');
  process.exit(1);
}

const DB_PATH = path.join(__dirname, '../.records.db');
const BLOB_DIR = path.join(__dirname, '../.records_blobs');
const ACCOUNT_ID = 'acc_demo_user'; // Matches the GUI demo persona

(async () => {
  const app = new PersonalRecordsApp({ dbPath: DB_PATH, blobDir: BLOB_DIR });

  // 1. Read the file from disk
  const fileBytes = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  const mimeMap = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.txt': 'text/plain'
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  console.log(`\n======================================================`);
  console.log(`[1] Uploading: ${fileName} (${fileBytes.length} bytes)`);
  console.log(`    Account:   ${ACCOUNT_ID}`);
  console.log(`    MIME Type: ${mimeType}`);
  console.log(`======================================================`);

  try {
    // 2. Upload document
    const uploadRes = await app.callTool('records.upload_document', {
      title: fileName,
      content_bytes: fileBytes.toString('base64'),
      mime_type: mimeType,
      category: 'other',
      tags: ['local_upload', ext.replace('.', '')]
    }, { accountId: ACCOUNT_ID, callerRole: 'agent' });

    console.log('\n[2] Upload Result:');
    console.log(JSON.stringify(uploadRes, null, 2));

    // 3. Retrieve metadata using the exact same ACCOUNT_ID
    const docMeta = await app.callTool('records.get_document', {
      document_id: uploadRes.document_id,
      include_extracted_text: true
    }, { accountId: ACCOUNT_ID });

    console.log('\n[3] Retrieved Record:');
    console.log(`    Document ID: ${docMeta.document_id}`);
    console.log(`    Status:      ${uploadRes.status}`);
    console.log(`    SHA-256:     ${docMeta.version.sha256}`);
    console.log(`    Blob Path:   ${docMeta.version.blob_path}`);

    if (docMeta.extraction?.raw_text) {
      console.log(`\n[4] Extracted Text Snippet (First 300 characters):\n---`);
      console.log(docMeta.extraction.raw_text.slice(0, 300));
      console.log(`---\n`);
    }

    console.log('[OK] Done! Open http://localhost:3000 to see it in the GUI.\n');
  } catch (err) {
    console.error('\n[X] Error:', err.message);
  } finally {
    app.close();
  }
})();