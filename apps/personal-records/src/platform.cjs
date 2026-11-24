const fs = require('fs');
const path = require('path');

class PlatformManager {
  constructor(db, blobStore, docService, evidenceService) {
    this.db = db;
    this.blobStore = blobStore;
    this.docService = docService;
    this.evidenceService = evidenceService;
    this.baselineManifest = null;
  }

  seed(manifest) {
    this.baselineManifest = manifest;
    const accountId = manifest.account_id;

    this.db.prepare('INSERT OR IGNORE INTO accounts (account_id) VALUES (?)').run(accountId);
    const docIdMap = {};

    if (Array.isArray(manifest.documents)) {
      for (const d of manifest.documents) {
        const res = this.docService.uploadDocument({
          accountId,
          title: d.title,
          contentBytes: Buffer.from(d.content_text || '', 'utf-8'),
          mimeType: d.mime_type || 'text/plain',
          category: d.category,
          tags: d.tags || [],
          validUntil: d.valid_until
        });
        docIdMap[d.fixture_id || d.title] = res.document_id;
      }
    }

    if (Array.isArray(manifest.links)) {
      for (const l of manifest.links) {
        const sourceId = docIdMap[l.source_ref] || l.source_id;
        const targetId = docIdMap[l.target_ref] || l.target_id;
        if (sourceId && targetId) {
          this.evidenceService.linkDocuments({
            accountId,
            sourceId,
            targetId,
            relationshipType: l.relationship_type,
            metadata: l.metadata || {}
          });
        }
      }
    }

    return {
      status: 'SEEDED',
      account_id: accountId,
      documents_seeded: Object.keys(docIdMap).length
    };
  }

  snapshot(accountId) {
    const documents = this.db.prepare('SELECT * FROM documents WHERE account_id = ?').all(accountId);
    const versions = this.db.prepare(`
      SELECT v.* FROM document_versions v
      JOIN documents d ON v.document_id = d.document_id
      WHERE d.account_id = ?
    `).all(accountId);
    const extractions = this.db.prepare(`
      SELECT e.* FROM extractions e
      JOIN documents d ON e.document_id = d.document_id
      WHERE d.account_id = ?
    `).all(accountId);
    const links = this.db.prepare('SELECT * FROM document_links WHERE account_id = ?').all(accountId);
    const claims = this.db.prepare('SELECT * FROM evidence_claims WHERE account_id = ?').all(accountId);
    const proposals = this.db.prepare('SELECT * FROM proposals WHERE account_id = ?').all(accountId);

    return {
      account_id: accountId,
      timestamp: new Date().toISOString(),
      documents,
      versions,
      extractions,
      links,
      claims,
      proposals
    };
  }

  reset(accountId) {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      this.db.prepare('DELETE FROM idempotency_keys WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM records_notifications WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM proposals WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM evidence_claims WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM document_links WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM fts_documents WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM documents WHERE account_id = ?').run(accountId);
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    const accBlobDir = path.join(this.blobStore.rootDir, accountId);
    if (fs.existsSync(accBlobDir)) {
      fs.rmSync(accBlobDir, { recursive: true, force: true });
      fs.mkdirSync(accBlobDir, { recursive: true });
    }

    if (this.baselineManifest && this.baselineManifest.account_id === accountId) {
      this.seed(this.baselineManifest);
    }

    return {
      status: 'RESET_COMPLETE',
      account_id: accountId
    };
  }

  executeIdempotent(accountId, operation, key, execFn) {
    if (!key) {
      return execFn();
    }

    const cached = this.db.prepare(
      'SELECT response_payload FROM idempotency_keys WHERE key = ? AND account_id = ?'
    ).get(key, accountId);

    if (cached) {
      return JSON.parse(cached.response_payload);
    }

    const result = execFn();

    // If execFn returned a Promise (e.g. async import_from_source)
    if (result && typeof result.then === 'function') {
      return result.then((resolved) => {
        this.db.prepare(`
          INSERT INTO idempotency_keys (key, account_id, operation, response_payload)
          VALUES (?, ?, ?, ?)
        `).run(key, accountId, operation, JSON.stringify(resolved));
        return resolved;
      });
    }

    // Synchronous execution path (e.g. upload_document)
    this.db.prepare(`
      INSERT INTO idempotency_keys (key, account_id, operation, response_payload)
      VALUES (?, ?, ?, ?)
    `).run(key, accountId, operation, JSON.stringify(result));

    return result;
  }
}

module.exports = { PlatformManager };
