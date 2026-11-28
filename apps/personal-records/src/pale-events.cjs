'use strict';
const { fail, decodeAndExtract, validateRepresentedDate } = require('./pale-model.cjs');
const { handleTool } = require('./pale-operations.cjs');

function applyEvent(ctx, data, event) {
  const op = event.operation;
  const payload = event.payload || {};
  const at = event.at || ctx.virtual_now || '1970-01-01T00:00:00Z';

  if (op === 'personal-records.upsert') {
    const id = payload.id || `doc_evt_${data.documents.length + 1}`;
    const existing = data.documents.find(d => d.id === id);
    const contentBytes = payload.content_bytes || Buffer.from(payload.raw_text || payload.title || 'Event document', 'utf8').toString('base64');
    const mimeType = payload.mime_type || 'text/plain';
    const ext = decodeAndExtract(contentBytes, mimeType, payload.raw_text);

    if (existing) {
      if (payload.title) existing.title = payload.title;
      if (payload.category) existing.category = payload.category;
      if (payload.tags) existing.tags = payload.tags;
      if (payload.valid_until !== undefined) existing.valid_until = payload.valid_until;
      existing.updated_at = at;
      existing.history.push({ at, action: 'event_upsert' });
      return data;
    }

    data.documents.push({
      id,
      account_id: data.account_id,
      title: payload.title || 'Event Document',
      category: payload.category || 'other',
      tags: payload.tags || [],
      current_version_number: 1,
      processing_status: ext.processingStatus,
      verification_state: 'INFERRED',
      valid_until: payload.valid_until ?? null,
      source_type: 'EVENT_UPSERT',
      source_reference: null,
      created_at: at,
      updated_at: at,
      history: [{ at, action: 'event_upsert' }],
      versions: [
        {
          version_number: 1,
          sha256: ext.sha256,
          mime_type: mimeType,
          byte_size: ext.byteSize,
          content_base64: contentBytes,
          change_summary: 'Injected via event',
          extraction_revision: 'ext_rev_01',
          extraction_source: ext.extractionSource,
          raw_text: ext.rawText,
          extracted_fields: ext.extractedFields,
          created_at: at
        }
      ]
    });
    return data;
  }

  if (op === 'personal-records.inject_document') {
    const contentBytes = payload.content_bytes || Buffer.from(payload.raw_text || `Injected from ${payload.source || 'external'}`, 'utf8').toString('base64');
    const mimeType = payload.mime_type || 'text/plain';
    const ext = decodeAndExtract(contentBytes, mimeType, payload.raw_text);
    const id = payload.id || `doc_inj_${data.documents.length + 1}`;
    if (data.documents.some(d => d.id === id)) {
      fail('invalid_event', `Document ${id} already exists`);
    }
    const representedDate = payload.represented_date !== undefined
      ? validateRepresentedDate(payload.represented_date)
      : null;

    data.documents.push({
      id,
      account_id: data.account_id,
      title: payload.title || `Injected ${payload.asset_id || id}`,
      category: payload.category || 'other',
      tags: payload.tags || [],
      current_version_number: 1,
      processing_status: ext.processingStatus,
      verification_state: 'INFERRED',
      valid_until: payload.valid_until ?? null,
      source_type: payload.source ? payload.source.toUpperCase() : 'EVENT_INJECT',
      source_reference: {
        source: payload.source || null,
        source_account: payload.source_account || null,
        message_id: payload.message_id || null,
        asset_id: payload.asset_id || null,
        ...(representedDate ? { represented_date: representedDate } : {}),
        ingested_at: at,
        ingestion_provenance: 'event_availability'
      },
      created_at: at,
      updated_at: at,
      history: [{ at, action: 'event_inject' }],
      versions: [
        {
          version_number: 1,
          sha256: ext.sha256,
          mime_type: mimeType,
          byte_size: ext.byteSize,
          content_base64: contentBytes,
          change_summary: 'Injected via scheduled event',
          extraction_revision: 'ext_rev_01',
          extraction_source: ext.extractionSource,
          raw_text: ext.rawText,
          extracted_fields: ext.extractedFields,
          created_at: at
        }
      ]
    });
    return data;
  }

  if (op === 'personal-records.expiry_check') {
    const out = handleTool({ ...ctx, virtual_now: at }, data, 'personal-records.check_expiries', {
      threshold_days: payload.threshold_days ?? 30,
      suppress_days: payload.suppress_days ?? 7
    });
    return out.data;
  }

  if (op === 'personal-records.confirm_decision') {
    const out = handleTool({ ...ctx, virtual_now: at, role: 'user' }, data, 'personal-records.confirm_update', {
      proposal_id: payload.proposal_id,
      decision: payload.decision,
      expected_proposal_hash: payload.expected_proposal_hash,
      expected_target_version: payload.expected_target_version,
      expected_target_state_hash: payload.expected_target_state_hash,
      rejection_reason: payload.rejection_reason
    });
    return out.data;
  }

  fail('invalid_event', `Unsupported event operation: ${op}`);
}

module.exports = { applyEvent };
