const path = require('path');
const { createDatabase } = require('./db.cjs');
const { BlobStore } = require('./blob-store.cjs');
const { ExtractionService } = require('./extraction.cjs');
const { DocumentService } = require('./document-service.cjs');
const { EvidenceService } = require('./evidence-service.cjs');
const { EventManager } = require('./events.cjs');
const { PlatformManager } = require('./platform.cjs');
const { AppAdapters } = require('./adapters.cjs');

class PersonalRecordsApp {
  constructor(options = {}) {
    const dbPath = options.dbPath || ':memory:';
    const blobDir = options.blobDir || path.join(process.cwd(), '.records_blobs');

    this.db = createDatabase(dbPath);
    this.blobStore = new BlobStore(blobDir);
    this.extractionService = new ExtractionService(options.fallbackManifest || {});
    this.docService = new DocumentService(this.db, this.blobStore, this.extractionService);
    this.evidenceService = new EvidenceService(this.db);
    this.eventManager = new EventManager(this.db, this.docService, this.evidenceService);
    this.platform = new PlatformManager(this.db, this.blobStore, this.docService, this.evidenceService);
  }

  async callTool(name, params = {}, context = {}) {
    const accountId = context.accountId || params.account_id || 'default_user';
    const callerRole = context.callerRole || 'agent';
    const idempotencyKey = params.idempotency_key;

    switch (name) {
      case 'records.upload_document': {
        return this.platform.executeIdempotent(accountId, name, idempotencyKey, async () => {
          return this.docService.uploadDocument({
            accountId,
            title: params.title,
            contentBytes: params.content_bytes,
            mimeType: params.mime_type,
            category: params.category,
            tags: params.tags,
            validUntil: params.valid_until
          });
        });
      }

      case 'records.import_from_source': {
        return this.platform.executeIdempotent(accountId, name, idempotencyKey, async () => {
          let fileData;
          if (params.source_app === 'mail') {
            fileData = await AppAdapters.importMailAttachment({
              mailClient: context.adapters?.mailClient,
              messageId: params.mail_params.id,
              assetId: params.mail_params.asset_id
            });
          } else if (params.source_app === 'files') {
            fileData = await AppAdapters.importFile({
              filesClient: context.adapters?.filesClient,
              fileId: params.files_params.id,
              versionNumber: params.files_params.number
            });
          } else {
            const err = new Error(`Unsupported source_app: ${params.source_app}`);
            err.code = 'UNSUPPORTED_SOURCE';
            throw err;
          }

          // Optional Contact entity matching during import
          const tags = params.tags || [];
          if (context.adapters?.contactsClient) {
            const matchedContact = await AppAdapters.matchContact({
              contactsClient: context.adapters.contactsClient,
              query: params.title
            });
            if (matchedContact) {
              tags.push(`contact:${matchedContact.contact_id}`);
            }
          }

          return this.docService.uploadDocument({
            accountId,
            title: params.title || fileData.filename,
            contentBytes: fileData.bytes,
            mimeType: fileData.mimeType,
            category: params.category,
            tags
          });
        });
      }

      case 'records.create_version': {
        return this.platform.executeIdempotent(accountId, name, idempotencyKey, async () => {
          return this.docService.createVersion({
            accountId,
            documentId: params.document_id,
            contentBytes: params.content_bytes,
            mimeType: params.mime_type,
            changeSummary: params.change_summary,
            expectedParentVersion: params.expected_parent_version
          });
        });
      }

      case 'records.get_document': {
        return this.docService.getDocument({
          accountId,
          documentId: params.document_id,
          versionNumber: params.version_number,
          includeExtractedText: params.include_extracted_text !== false,
          includeClaims: Boolean(params.include_claims)
        });
      }

      case 'records.search': {
        return this.docService.search({
          accountId,
          query: params.query,
          category: params.category,
          verificationState: params.verification_state,
          validBefore: params.valid_before,
          validAfter: params.valid_after,
          limit: params.limit,
          offset: params.offset
        });
      }

      case 'records.link_documents': {
        return this.evidenceService.linkDocuments({
          accountId,
          sourceId: params.source_id,
          targetId: params.target_id,
          relationshipType: params.relationship_type,
          metadata: params.metadata
        });
      }

      case 'records.create_evidence_claim': {
        return this.evidenceService.createEvidenceClaim({
          accountId,
          documentId: params.document_id,
          versionNumber: params.version_number,
          extractionRevision: params.extraction_revision,
          startOffset: params.start_offset,
          endOffset: params.end_offset,
          citedText: params.cited_text,
          claimText: params.claim_text
        });
      }

      case 'records.propose_update': {
        return this.evidenceService.proposeUpdate({
          accountId,
          callerRole,
          targetType: params.target_type,
          targetId: params.target_id,
          expectedVersion: params.expected_version,
          proposedChanges: params.proposed_changes,
          rationale: params.rationale
        });
      }

      case 'records.confirm_update': {
        return this.evidenceService.confirmUpdate({
          accountId,
          callerRole,
          proposalId: params.proposal_id,
          decision: params.decision,
          rejectionReason: params.rejection_reason
        });
      }

      default: {
        const err = new Error(`Unknown tool: ${name}`);
        err.code = 'TOOL_NOT_FOUND';
        throw err;
      }
    }
  }

  seed(manifest) {
    return this.platform.seed(manifest);
  }

  reset(accountId) {
    return this.platform.reset(accountId);
  }

  snapshot(accountId) {
    return this.platform.snapshot(accountId);
  }

  close() {
    this.db.close();
  }
}

module.exports = { PersonalRecordsApp };
