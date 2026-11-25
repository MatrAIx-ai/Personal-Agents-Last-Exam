const crypto = require('crypto');

class DocumentService {
  constructor(db, blobStore, extractionService) {
    this.db = db;
    this.blobStore = blobStore;
    this.extractionService = extractionService;
  }

  uploadDocument({ accountId, title, contentBytes, mimeType, category, tags = [], validUntil }) {
    
    const SUPPORTED_MIMES = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'text/plain',
      'application/octet-stream'
    ];

    if (mimeType && !SUPPORTED_MIMES.includes(mimeType)) {
      const err = new Error(`Unsupported format: ${mimeType}`);
      err.code = 'UNSUPPORTED_FORMAT';
      throw err;
    }

    const buffer = Buffer.isBuffer(contentBytes) ? contentBytes : Buffer.from(contentBytes, 'base64');
    const { relPath, sha256, byteSize } = this.blobStore.saveBytes(accountId, buffer, title.slice(0, 20));

    // Deduplication check
    const existing = this.db.prepare(`
      SELECT d.document_id 
      FROM document_versions v
      JOIN documents d ON v.document_id = d.document_id
      WHERE d.account_id = ? AND v.sha256 = ?
      LIMIT 1
    `).get(accountId, sha256);

    if (existing) {
      this.blobStore.deleteBlob(relPath);
      const error = new Error(`Duplicate document detected: ${existing.document_id}`);
      error.code = 'DUPLICATE_DOCUMENT';
      error.existingDocumentId = existing.document_id;
      error.sha256 = sha256;
      throw error;
    }

    const docId = `doc_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const versionNumber = 1;
    const versionId = `${docId}_v1`;
    const extractionId = `ext_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const doInsert = (ext) => {
      this.db.exec('BEGIN TRANSACTION;');
      try {
        this.db.prepare('INSERT OR IGNORE INTO accounts (account_id) VALUES (?)').run(accountId);

        this.db.prepare(`
          INSERT INTO documents (
            document_id, account_id, title, category, tags,
            current_version_number, verification_state, valid_until
          ) VALUES (?, ?, ?, ?, ?, ?, 'INFERRED', ?)
        `).run(docId, accountId, title, category || null, JSON.stringify(tags), versionNumber, validUntil || null);

        this.db.prepare(`
          INSERT INTO document_versions (
            version_id, document_id, version_number, sha256,
            mime_type, byte_size, blob_path, source_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UPLOAD')
        `).run(versionId, docId, versionNumber, sha256, mimeType, byteSize, relPath);

        this.db.prepare(`
          INSERT INTO extractions (
            extraction_id, document_id, version_number, extraction_revision,
            raw_text, extracted_fields, extraction_source
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(extractionId, docId, versionNumber, ext.extractionRevision, ext.rawText, JSON.stringify(ext.extractedFields), ext.extractionSource);

        this.db.prepare(`
          INSERT INTO fts_documents (document_id, account_id, title, category, tags, raw_text)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(docId, accountId, title, category || '', JSON.stringify(tags), ext.rawText);

        this.db.exec('COMMIT;');
      } catch (err) {
        this.db.exec('ROLLBACK;');
        this.blobStore.deleteBlob(relPath);
        throw err;
      }

      return {
        document_id: docId,
        version_number: versionNumber,
        sha256,
        status: ext.extractionSource !== 'DEFERRED_RAW' ? 'READY' : 'PARSING'
      };
    };

    const extResult = this.extractionService.extract(buffer, mimeType, sha256);

    // If extract returned a Promise (async PDF parsing)
    if (extResult && typeof extResult.then === 'function') {
      return extResult.then(doInsert).catch((err) => {
        this.blobStore.deleteBlob(relPath);
        throw err;
      });
    }

    // Synchronous execution path (text/plain & fixtures)
    return doInsert(extResult);
  }

  createVersion({ accountId, documentId, contentBytes, mimeType, changeSummary, expectedParentVersion }) {
    const doc = this.db.prepare(`
      SELECT current_version_number, title, category, tags
      FROM documents 
      WHERE document_id = ? AND account_id = ?
    `).get(documentId, accountId);

    if (!doc) {
      const err = new Error(`Document ${documentId} not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (expectedParentVersion !== undefined && expectedParentVersion !== doc.current_version_number) {
      const err = new Error(`Expected parent version ${expectedParentVersion}, but current is ${doc.current_version_number}`);
      err.code = 'STALE_VERSION';
      throw err;
    }

    const buffer = Buffer.isBuffer(contentBytes) ? contentBytes : Buffer.from(contentBytes, 'base64');
    const newVersionNumber = doc.current_version_number + 1;
    const versionId = `${documentId}_v${newVersionNumber}`;
    const { relPath, sha256, byteSize } = this.blobStore.saveBytes(
      accountId,
      buffer,
      `${doc.title.slice(0, 15)}_v${newVersionNumber}`
    );

    const extractionId = `ext_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const doInsertVersion = (ext) => {
      this.db.exec('BEGIN TRANSACTION;');
      try {
        this.db.prepare(`
          UPDATE documents 
          SET current_version_number = ?, verification_state = 'INFERRED', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE document_id = ?
        `).run(newVersionNumber, documentId);

        this.db.prepare(`
          INSERT INTO document_versions (
            version_id, document_id, version_number, sha256,
            mime_type, byte_size, blob_path, change_summary, source_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UPLOAD')
        `).run(versionId, documentId, newVersionNumber, sha256, mimeType, byteSize, relPath, changeSummary || null);

        this.db.prepare(`
          INSERT INTO extractions (
            extraction_id, document_id, version_number, extraction_revision,
            raw_text, extracted_fields, extraction_source
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(extractionId, documentId, newVersionNumber, ext.extractionRevision, ext.rawText, JSON.stringify(ext.extractedFields), ext.extractionSource);

        this.db.prepare(`DELETE FROM fts_documents WHERE document_id = ?`).run(documentId);
        this.db.prepare(`
          INSERT INTO fts_documents (document_id, account_id, title, category, tags, raw_text)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(documentId, accountId, doc.title, doc.category || '', doc.tags, ext.rawText);

        this.db.prepare(`
          UPDATE evidence_claims
          SET verification_state = 'REVIEW_REQUIRED'
          WHERE document_id = ? AND version_number < ?
        `).run(documentId, newVersionNumber);

        this.db.exec('COMMIT;');
      } catch (err) {
        this.db.exec('ROLLBACK;');
        this.blobStore.deleteBlob(relPath);
        throw err;
      }

      return {
        document_id: documentId,
        version_number: newVersionNumber,
        sha256,
        status: 'READY'
      };
    };

    const extResult = this.extractionService.extract(buffer, mimeType, sha256);

    if (extResult && typeof extResult.then === 'function') {
      return extResult.then(doInsertVersion).catch((err) => {
        this.blobStore.deleteBlob(relPath);
        throw err;
      });
    }

    return doInsertVersion(extResult);
  }

  getDocument({ accountId, documentId, versionNumber, includeExtractedText = true, includeClaims = false, includeLinks = false }) {
    const doc = this.db.prepare(`
      SELECT document_id, account_id, title, category, tags, current_version_number,
             verification_state, valid_until, created_at, updated_at
      FROM documents
      WHERE document_id = ? AND account_id = ?
    `).get(documentId, accountId);

    if (!doc) {
      const err = new Error(`Document ${documentId} not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const targetVersion = versionNumber !== undefined ? versionNumber : doc.current_version_number;

    const ver = this.db.prepare(`
      SELECT version_number, sha256, mime_type, byte_size, blob_path, change_summary, source_type, created_at
      FROM document_versions
      WHERE document_id = ? AND version_number = ?
    `).get(documentId, targetVersion);

    if (!ver) {
      const err = new Error(`Version ${targetVersion} not found for document ${documentId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const result = {
      document_id: doc.document_id,
      title: doc.title,
      category: doc.category,
      tags: JSON.parse(doc.tags),
      current_version_number: doc.current_version_number,
      verification_state: doc.verification_state,
      valid_until: doc.valid_until,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      version: ver
    };

    if (includeExtractedText) {
      const ext = this.db.prepare(`
        SELECT extraction_revision, raw_text, extracted_fields, extraction_source
        FROM extractions
        WHERE document_id = ? AND version_number = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(documentId, targetVersion);

      if (ext) {
        result.extraction = {
          extraction_revision: ext.extraction_revision,
          raw_text: ext.raw_text,
          extracted_fields: JSON.parse(ext.extracted_fields),
          extraction_source: ext.extraction_source
        };
      }
    }

    if (includeClaims) {
      const claims = this.db.prepare(`
        SELECT claim_id, start_offset, end_offset, cited_text, claim_text, verification_state
        FROM evidence_claims
        WHERE document_id = ? AND version_number = ?
      `).all(documentId, targetVersion);
      result.claims = claims;
    }

    if (includeLinks) {
      result.links = {
        outgoing: this.db.prepare(`
          SELECT link_id, target_id, relationship_type, metadata 
          FROM document_links WHERE source_id = ? AND account_id = ?
        `).all(documentId, accountId),
        incoming: this.db.prepare(`
          SELECT link_id, source_id, relationship_type, metadata 
          FROM document_links WHERE target_id = ? AND account_id = ?
        `).all(documentId, accountId)
      };
    }

    return result;
  }

  search({ accountId, query, category, verificationState, validBefore, validAfter, limit = 20, offset = 0 }) {
    limit = Math.min(limit, 50);
    const where = ['d.account_id = ?'];
    const params = [accountId];
    let joinFts = '';

    if (query && query.trim()) {
      joinFts = 'JOIN fts_documents ON d.document_id = fts_documents.document_id';
      where.push('fts_documents MATCH ?');
      const tokens = query.trim().match(/"[^"]*"|\S+/g) || [];
      const sanitized = tokens
        .map((t) => (t.startsWith('"') && t.endsWith('"') ? t : `"${t.replace(/"/g, '""')}"`))
        .join(' ');
      params.push(sanitized);
    }

    if (category) {
      where.push('d.category = ?');
      params.push(category);
    }

    if (verificationState) {
      where.push('d.verification_state = ?');
      params.push(verificationState);
    }

    if (validBefore) {
      where.push('d.valid_until <= ?');
      params.push(validBefore);
    }

    if (validAfter) {
      where.push('d.valid_until >= ?');
      params.push(validAfter);
    }

    params.push(limit, offset);

    const sql = `
      SELECT d.document_id, d.title, d.category, d.current_version_number,
             d.verification_state, d.valid_until
      FROM documents d
      ${joinFts}
      WHERE ${where.join(' AND ')}
      ORDER BY d.updated_at DESC
      LIMIT ? OFFSET ?
    `;

    return this.db.prepare(sql).all(...params);
  }
}

module.exports = { DocumentService };
