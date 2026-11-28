'use strict';
const crypto = require('node:crypto');
const { fail, decodeAndExtract, computeProposalHash, computeTargetStateHash, validateProposedChanges } = require('./pale-model.cjs');

function nextId(prefix, existing) {
  let n = existing.length + 1;
  while (existing.some(item => item.id === `${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

function handleTool(ctx, data, name, args) {
  const now = ctx.virtual_now || '1970-01-01T00:00:00Z';
  const accountId = data.account_id;

  switch (name) {
    case 'personal-records.search': {
      const q = (args.query || '').trim().toLowerCase();
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;

      const validBeforeMs = args.valid_before ? Date.parse(args.valid_before) : null;
      const validAfterMs = args.valid_after ? Date.parse(args.valid_after) : null;

      const filtered = data.documents.filter(doc => {
        if (args.category && doc.category !== args.category) return false;
        if (args.verification_state && doc.verification_state !== args.verification_state) return false;
        if (validBeforeMs !== null) {
          const docValidMs = doc.valid_until ? Date.parse(doc.valid_until) : NaN;
          if (!Number.isFinite(docValidMs) || docValidMs > validBeforeMs) return false;
        }
        if (validAfterMs !== null) {
          const docValidMs = doc.valid_until ? Date.parse(doc.valid_until) : NaN;
          if (!Number.isFinite(docValidMs) || docValidMs < validAfterMs) return false;
        }
        if (q) {
          const latest = doc.versions.find(v => v.version_number === doc.current_version_number) || doc.versions[doc.versions.length - 1];
          const haystack = [
            doc.id,
            doc.title,
            doc.category,
            ...(doc.tags || []),
            latest?.raw_text || ''
          ].join(' ').toLowerCase();
          const terms = q.split(/\s+/).filter(Boolean);
          if (!terms.every(term => haystack.includes(term))) return false;
        }
        return true;
      });

      const items = filtered.slice(offset, offset + limit).map(doc => ({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        tags: doc.tags,
        current_version_number: doc.current_version_number,
        processing_status: doc.processing_status,
        verification_state: doc.verification_state,
        valid_until: doc.valid_until ?? null,
        updated_at: doc.updated_at
      }));

      return { data, result: { items, total: filtered.length } };
    }

    case 'personal-records.get_document': {
      const doc = data.documents.find(d => d.id === args.id);
      if (!doc) fail('not_found', `Document ${args.id} not found`);

      const targetVer = args.version_number || doc.current_version_number;
      const ver = doc.versions.find(v => v.version_number === targetVer);
      if (!ver) fail('not_found', `Version ${targetVer} not found for document ${args.id}`);

      const item = {
        ...doc,
        selected_version: {
          version_number: ver.version_number,
          sha256: ver.sha256,
          mime_type: ver.mime_type,
          byte_size: ver.byte_size,
          change_summary: ver.change_summary ?? null,
          extraction_revision: ver.extraction_revision,
          extraction_source: ver.extraction_source,
          raw_text: args.include_extracted_text === false ? undefined : ver.raw_text,
          extracted_fields: ver.extracted_fields,
          created_at: ver.created_at
        }
      };

      if (args.include_claims !== false) {
        item.claims = data.claims.filter(c => c.document_id === doc.id && c.version_number === targetVer);
      }
      if (args.include_links !== false) {
        item.links = data.links.filter(l => l.source_id === doc.id || l.target_id === doc.id);
      }

      return { data, result: { item } };
    }

    case 'personal-records.list_proposals': {
      const proposals = args.status
        ? data.proposals.filter(p => p.status === args.status)
        : data.proposals.slice();
      return { data, result: { proposals } };
    }

    case 'personal-records.list_links': {
      const links = args.document_id
        ? data.links.filter(l => l.source_id === args.document_id || l.target_id === args.document_id)
        : data.links.slice();
      return { data, result: { links } };
    }

    case 'personal-records.upload_document': {
      const ext = decodeAndExtract(args.content_bytes, args.mime_type, args.raw_text_override);
      const duplicate = data.documents.find(d => d.versions.some(v => v.sha256 === ext.sha256));
      if (duplicate) {
        fail('duplicate_document', `Duplicate document detected: ${duplicate.id}`);
      }

      const docId = nextId('doc', data.documents);
      const newDoc = {
        id: docId,
        account_id: accountId,
        title: args.title,
        category: args.category || 'other',
        tags: args.tags || [],
        current_version_number: 1,
        processing_status: ext.processingStatus,
        verification_state: 'INFERRED',
        valid_until: args.valid_until ?? null,
        source_type: 'UPLOAD',
        source_reference: null,
        created_at: now,
        updated_at: now,
        history: [{ at: now, action: 'uploaded_v1' }],
        versions: [
          {
            version_number: 1,
            sha256: ext.sha256,
            mime_type: args.mime_type,
            byte_size: ext.byteSize,
            content_base64: args.content_bytes,
            change_summary: null,
            extraction_revision: 'ext_rev_01',
            extraction_source: ext.extractionSource,
            raw_text: ext.rawText,
            extracted_fields: ext.extractedFields,
            created_at: now
          }
        ]
      };

      data.documents.push(newDoc);
      return {
        data,
        result: {
          document_id: docId,
          version_number: 1,
          sha256: ext.sha256,
          processing_status: ext.processingStatus
        }
      };
    }

    case 'personal-records.import_from_source': {
      const payload = args.source_payload;
      if (!payload || !payload.content_bytes) {
        fail('source_unavailable', `Source ${args.source_app} payload missing or unavailable`);
      }
      const mimeType = payload.mime_type || 'text/plain';
      const ext = decodeAndExtract(payload.content_bytes, mimeType);
      const duplicate = data.documents.find(d => d.versions.some(v => v.sha256 === ext.sha256));
      if (duplicate) {
        fail('duplicate_document', `Duplicate document detected: ${duplicate.id}`);
      }

      const docId = nextId('doc', data.documents);
      const newDoc = {
        id: docId,
        account_id: accountId,
        title: args.title || payload.filename || 'Imported Document',
        category: args.category || 'other',
        tags: args.tags || [],
        current_version_number: 1,
        processing_status: ext.processingStatus,
        verification_state: 'INFERRED',
        valid_until: null,
        source_type: args.source_app.toUpperCase() + '_IMPORT',
        source_reference: {
          source_app: args.source_app,
          id: payload.id || null,
          asset_id: payload.asset_id || null,
          number: payload.number || null
        },
        created_at: now,
        updated_at: now,
        history: [{ at: now, action: `imported_from_${args.source_app}` }],
        versions: [
          {
            version_number: 1,
            sha256: ext.sha256,
            mime_type: mimeType,
            byte_size: ext.byteSize,
            content_base64: payload.content_bytes,
            change_summary: `Imported from ${args.source_app}`,
            extraction_revision: 'ext_rev_01',
            extraction_source: ext.extractionSource,
            raw_text: ext.rawText,
            extracted_fields: ext.extractedFields,
            created_at: now
          }
        ]
      };

      data.documents.push(newDoc);
      return {
        data,
        result: {
          document_id: docId,
          version_number: 1,
          sha256: ext.sha256
        }
      };
    }

    case 'personal-records.create_version': {
      const doc = data.documents.find(d => d.id === args.document_id);
      if (!doc) fail('not_found', `Document ${args.document_id} not found`);
      if (args.expected_parent_version !== undefined && args.expected_parent_version !== doc.current_version_number) {
        fail('stale_version', `Expected parent version ${args.expected_parent_version}, current is ${doc.current_version_number}`);
      }

      const ext = decodeAndExtract(args.content_bytes, args.mime_type);
      const newVersionNumber = doc.current_version_number + 1;
      doc.current_version_number = newVersionNumber;
      doc.verification_state = 'INFERRED';
      doc.processing_status = ext.processingStatus;
      doc.updated_at = now;
      doc.history.push({ at: now, action: `created_v${newVersionNumber}` });
      doc.versions.push({
        version_number: newVersionNumber,
        sha256: ext.sha256,
        mime_type: args.mime_type,
        byte_size: ext.byteSize,
        content_base64: args.content_bytes,
        change_summary: args.change_summary || null,
        extraction_revision: 'ext_rev_01',
        extraction_source: ext.extractionSource,
        raw_text: ext.rawText,
        extracted_fields: ext.extractedFields,
        created_at: now
      });

      return {
        data,
        result: {
          document_id: doc.id,
          version_number: newVersionNumber,
          sha256: ext.sha256
        }
      };
    }

    case 'personal-records.link_documents': {
      const source = data.documents.find(d => d.id === args.source_id);
      if (!source) fail('not_found', `Source document ${args.source_id} not found`);
      const target = data.documents.find(d => d.id === args.target_id);
      if (!target) fail('link_target_not_found', `Target document ${args.target_id} not found`);

      const existing = data.links.find(
        l => l.source_id === args.source_id && l.target_id === args.target_id && l.relationship_type === args.relationship_type
      );
      if (existing) {
        existing.metadata = args.metadata || {};
        return {
          data,
          result: {
            link_id: existing.id,
            source_id: existing.source_id,
            target_id: existing.target_id,
            relationship_type: existing.relationship_type
          }
        };
      }

      const linkId = nextId('lnk', data.links);
      data.links.push({
        id: linkId,
        account_id: accountId,
        source_id: args.source_id,
        target_id: args.target_id,
        relationship_type: args.relationship_type,
        metadata: args.metadata || {},
        created_at: now
      });

      return {
        data,
        result: {
          link_id: linkId,
          source_id: args.source_id,
          target_id: args.target_id,
          relationship_type: args.relationship_type
        }
      };
    }

    case 'personal-records.create_evidence_claim': {
      const doc = data.documents.find(d => d.id === args.document_id);
      if (!doc) fail('not_found', `Document ${args.document_id} not found`);
      const ver = doc.versions.find(v => v.version_number === args.version_number && v.extraction_revision === args.extraction_revision);
      if (!ver) fail('not_found', `Extraction revision ${args.extraction_revision} for version ${args.version_number} not found`);

      if (args.start_offset < 0 || args.end_offset > ver.raw_text.length || args.start_offset >= args.end_offset) {
        fail('invalid_passage_reference', `Invalid passage offset bounds [${args.start_offset}, ${args.end_offset}]`);
      }
      const actualSlice = ver.raw_text.slice(args.start_offset, args.end_offset);
      if (actualSlice !== args.cited_text) {
        fail('invalid_passage_reference', `Cited text mismatch at [${args.start_offset}, ${args.end_offset}]`);
      }

      const claimId = nextId('clm', data.claims);
      data.claims.push({
        id: claimId,
        account_id: accountId,
        document_id: args.document_id,
        version_number: args.version_number,
        extraction_revision: args.extraction_revision,
        start_offset: args.start_offset,
        end_offset: args.end_offset,
        cited_text: args.cited_text,
        claim_text: args.claim_text,
        verification_state: 'INFERRED',
        created_at: now
      });

      return {
        data,
        result: {
          claim_id: claimId,
          document_id: args.document_id,
          version_number: args.version_number,
          verification_state: 'INFERRED'
        }
      };
    }

    case 'personal-records.propose_update': {
      validateProposedChanges(args.target_type, args.proposed_changes);

      let targetObj = null;
      let parentDoc = null;
      if (args.target_type === 'document_metadata') {
        targetObj = data.documents.find(d => d.id === args.target_id);
        if (!targetObj) fail('not_found', `Target document ${args.target_id} not found`);
        parentDoc = targetObj;
      } else {
        targetObj = data.claims.find(c => c.id === args.target_id);
        if (!targetObj) fail('not_found', `Target claim ${args.target_id} not found`);
        parentDoc = data.documents.find(d => d.id === targetObj.document_id);
      }

      const proposalId = nextId('prop', data.proposals);
      const expectedTargetVer = args.expected_target_version;
      if (typeof expectedTargetVer !== 'number' || expectedTargetVer < 1) {
        fail('invalid_arguments', 'expected_target_version is required to bind proposal to target revision');
      }
      const targetStateHash = computeTargetStateHash(args.target_type, targetObj, parentDoc);
      const proposalHash = computeProposalHash({
        target_type: args.target_type,
        target_id: args.target_id,
        expected_version: expectedTargetVer,
        target_state_hash: targetStateHash,
        proposed_changes: args.proposed_changes
      });
      data.proposals.push({
        id: proposalId,
        account_id: accountId,
        caller_role: ctx.role || 'agent',
        target_type: args.target_type,
        target_id: args.target_id,
        expected_version: expectedTargetVer,
        proposed_changes: args.proposed_changes,
        rationale: args.rationale,
        proposal_hash: proposalHash,
        target_state_hash: targetStateHash,
        status: 'PENDING',
        rejection_reason: null,
        created_at: now,
        resolved_at: null
      });

      return {
        data,
        result: {
          proposal_id: proposalId,
          proposal_status: 'PENDING',
          proposal_hash: proposalHash,
          target_state_hash: targetStateHash
        }
      };
    }

    case 'personal-records.confirm_update': {
      const proposal = data.proposals.find(p => p.id === args.proposal_id);
      if (!proposal) fail('not_found', `Proposal ${args.proposal_id} not found`);
      if (proposal.status !== 'PENDING') {
        fail('invalid_state', `Proposal ${args.proposal_id} is already ${proposal.status}`);
      }
      const expectedHash = proposal.proposal_hash || computeProposalHash(proposal);
      if (args.expected_proposal_hash && args.expected_proposal_hash !== expectedHash) {
        fail('proposal_mismatch', `Proposal hash mismatch for ${args.proposal_id}`);
      }
      if (args.expected_target_version !== undefined && proposal.expected_version !== null && args.expected_target_version !== proposal.expected_version) {
        fail('stale_proposal_version', `Target version mismatch for ${args.proposal_id}`);
      }
      if (proposal.expected_version === null) {
        fail('unbound_proposal', `Proposal ${args.proposal_id} is missing target version binding`);
      }

      // Validate target, version, and editable target state fingerprint BEFORE any mutation
      validateProposedChanges(proposal.target_type, proposal.proposed_changes);
      let targetDoc = null;
      let targetClaim = null;
      let currentTargetStateHash = null;
      if (proposal.target_type === 'document_metadata') {
        targetDoc = data.documents.find(d => d.id === proposal.target_id);
        if (!targetDoc) fail('not_found', `Target document ${proposal.target_id} not found`);
        if (proposal.expected_version !== targetDoc.current_version_number) {
          fail('stale_proposal_version', `Document version changed while proposal was pending`);
        }
        currentTargetStateHash = computeTargetStateHash('document_metadata', targetDoc, targetDoc);
      } else if (proposal.target_type === 'claim') {
        targetClaim = data.claims.find(c => c.id === proposal.target_id);
        if (!targetClaim) fail('not_found', `Target claim ${proposal.target_id} not found`);
        targetDoc = data.documents.find(d => d.id === targetClaim.document_id);
        if (!targetDoc || proposal.expected_version !== targetDoc.current_version_number) {
          fail('stale_proposal_version', `Parent document version changed while claim proposal was pending`);
        }
        currentTargetStateHash = computeTargetStateHash('claim', targetClaim, targetDoc);
      } else {
        fail('invalid_state', `Unsupported target_type in v1: ${proposal.target_type}`);
      }

      if (args.expected_target_state_hash && args.expected_target_state_hash !== currentTargetStateHash) {
        fail('stale_proposal_version', `Editable target state changed while proposal was pending`);
      }
      if (proposal.target_state_hash && proposal.target_state_hash !== currentTargetStateHash) {
        fail('stale_proposal_version', `Target state fingerprint no longer matches proposal`);
      }

      if (args.decision === 'REJECT' || args.decision === 'CANCEL') {
        const finalStatus = args.decision === 'REJECT' ? 'REJECTED' : 'CANCELLED';
        proposal.status = finalStatus;
        proposal.rejection_reason = args.rejection_reason || null;
        proposal.resolved_at = now;
        return {
          data,
          result: {
            proposal_id: proposal.id,
            proposal_status: finalStatus
          }
        };
      }

      // APPROVE
      if (proposal.target_type === 'document_metadata') {
        const changes = proposal.proposed_changes || {};
        if (changes.title !== undefined) targetDoc.title = changes.title;
        if (changes.category !== undefined) targetDoc.category = changes.category;
        if (changes.tags !== undefined) targetDoc.tags = changes.tags;
        if (changes.valid_until !== undefined) targetDoc.valid_until = changes.valid_until;
        targetDoc.verification_state = changes.verification_state || 'USER_CONFIRMED';
        targetDoc.updated_at = now;
        targetDoc.history.push({ at: now, action: `confirmed_${proposal.id}` });
      } else if (proposal.target_type === 'claim') {
        const changes = proposal.proposed_changes || {};
        if (changes.claim_text !== undefined) targetClaim.claim_text = changes.claim_text;
        targetClaim.verification_state = changes.verification_state || 'USER_CONFIRMED';
      }

      proposal.status = 'USER_CONFIRMED';
      proposal.resolved_at = now;
      return {
        data,
        result: {
          proposal_id: proposal.id,
          proposal_status: 'USER_CONFIRMED'
        }
      };
    }

    case 'personal-records.check_expiries': {
      const thresholdDays = args.threshold_days ?? 30;
      const suppressDays = args.suppress_days ?? 7;
      const vNowMs = Date.parse(now);
      const thresholdMs = vNowMs + thresholdDays * 86400000;
      const suppressMs = vNowMs - suppressDays * 86400000;

      const dispatched = [];
      for (const doc of data.documents) {
        if (!doc.valid_until) continue;
        const validUntilMs = Date.parse(doc.valid_until);
        if (!Number.isFinite(validUntilMs) || validUntilMs > thresholdMs) continue;
        const recent = data.notifications.find(
          n => n.document_id === doc.id && n.notification_type === 'EXPIRY_ALERT' && Date.parse(n.dispatched_at) >= suppressMs
        );
        if (recent) continue;

        const notifId = nextId('notif', data.notifications);
        const subject = `Document Expiry Notice: ${doc.title}`;
        const bodyText = `Document '${doc.title}' (${doc.id}) expires on ${doc.valid_until}. Please review renewal.`;
        const cloudEvent = {
          specversion: '1.0',
          type: 'urn:pale:email-message:2',
          source: '/app/personal-records',
          id: notifId,
          time: now,
          datacontenttype: 'application/json',
          data: {
            recipient: `${accountId}@example.com`,
            subject,
            body_text: bodyText,
            asset_ids: []
          }
        };

        const notif = {
          id: notifId,
          account_id: accountId,
          notification_type: 'EXPIRY_ALERT',
          document_id: doc.id,
          subject,
          body_text: bodyText,
          dispatched_at: now,
          cloud_event: cloudEvent
        };
        data.notifications.push(notif);
        dispatched.push(notif);
      }

      return { data, result: { dispatched } };
    }

    case 'personal-records.check_discrepancies': {
      const newerDoc = data.documents.find(d => d.id === args.newer_document_id);
      const olderDoc = data.documents.find(d => d.id === args.older_document_id);
      if (!newerDoc || !olderDoc) {
        fail('not_found', 'One or both documents for discrepancy check were not found');
      }

      const newerVer = newerDoc.versions[newerDoc.versions.length - 1];
      const olderVer = olderDoc.versions[olderDoc.versions.length - 1];
      const newerFields = newerVer.extracted_fields || {};
      const olderFields = olderVer.extracted_fields || {};

      const discrepancies = [];
      for (const key of Object.keys(newerFields)) {
        if (typeof newerFields[key] === 'number' && typeof olderFields[key] === 'number' && newerFields[key] !== olderFields[key]) {
          discrepancies.push({
            field: key,
            older_value: olderFields[key],
            newer_value: newerFields[key],
            delta: newerFields[key] - olderFields[key]
          });
        }
      }

      if (discrepancies.length > 0 && newerDoc.verification_state !== 'USER_CONFIRMED') {
        const notifId = nextId('notif', data.notifications);
        const subject = `Material Discrepancy Flag: ${newerDoc.title}`;
        const bodyText = `Unconfirmed numerical variance detected between ${newerDoc.id} and ${olderDoc.id}: ${JSON.stringify(discrepancies)}`;
        data.notifications.push({
          id: notifId,
          account_id: accountId,
          notification_type: 'DISCREPANCY_FLAG',
          document_id: newerDoc.id,
          subject,
          body_text: bodyText,
          dispatched_at: now
        });
        return { data, result: { flagged: true, discrepancies } };
      }

      return { data, result: { flagged: false, discrepancies: [] } };
    }

    default:
      fail('unknown_tool', `Unknown tool: ${name}`);
  }
}

module.exports = { handleTool };
