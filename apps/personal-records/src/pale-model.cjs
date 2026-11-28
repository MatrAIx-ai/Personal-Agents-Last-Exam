'use strict';
const crypto = require('node:crypto');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function computeProposalHash({ target_type, target_id, expected_version, target_state_hash, proposed_changes }) {
  const canonical = JSON.stringify({
    target_type,
    target_id,
    expected_version: expected_version ?? null,
    target_state_hash: target_state_hash || null,
    proposed_changes: proposed_changes || {}
  });
  return sha256Hex(Buffer.from(canonical, 'utf8'));
}

function computeTargetStateHash(targetType, target, parentDoc) {
  if (targetType === 'document_metadata') {
    return sha256Hex(Buffer.from(JSON.stringify({
      title: target.title,
      category: target.category,
      tags: target.tags || [],
      valid_until: target.valid_until ?? null,
      verification_state: target.verification_state,
      current_version_number: target.current_version_number
    }), 'utf8'));
  }
  if (targetType === 'claim') {
    return sha256Hex(Buffer.from(JSON.stringify({
      document_id: target.document_id,
      version_number: target.version_number,
      extraction_revision: target.extraction_revision,
      start_offset: target.start_offset,
      end_offset: target.end_offset,
      cited_text: target.cited_text,
      claim_text: target.claim_text,
      verification_state: target.verification_state,
      parent_doc_version: parentDoc ? parentDoc.current_version_number : null
    }), 'utf8'));
  }
  return null;
}

const VALID_CATEGORIES = ['tax', 'employment', 'insurance', 'property', 'utilities', 'healthcare', 'banking', 'legal', 'other'];
const VALID_VERIFICATION_STATES = ['INFERRED', 'USER_CONFIRMED', 'SUPERSEDED'];
const STRICT_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isStrictDateTime(value) {
  if (typeof value !== 'string' || !STRICT_DATE_TIME_RE.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  // Reject calendar overflows like 2026-02-30
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

function validateRepresentedDate(rep) {
  if (!rep || typeof rep !== 'object' || Array.isArray(rep)) {
    fail('invalid_event', 'represented_date must be an object');
  }
  if (!['day', 'month', 'unresolved'].includes(rep.precision)) {
    fail('invalid_event', 'represented_date.precision must be day, month, or unresolved');
  }
  if (typeof rep.provenance !== 'string' || !rep.provenance.trim()) {
    fail('invalid_event', 'represented_date.provenance must be a nonempty string');
  }
  if (rep.precision === 'day') {
    if (typeof rep.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rep.value) || !isStrictDateTime(`${rep.value}T00:00:00Z`)) {
      fail('invalid_event', 'represented_date.value must be a valid YYYY-MM-DD date for day precision');
    }
  } else if (rep.precision === 'month') {
    if (typeof rep.value !== 'string' || !/^\d{4}-\d{2}$/.test(rep.value)) {
      fail('invalid_event', 'represented_date.value must be YYYY-MM for month precision');
    }
    const monthNum = Number(rep.value.slice(5, 7));
    if (monthNum < 1 || monthNum > 12) {
      fail('invalid_event', 'represented_date.value month out of range');
    }
  } else if (rep.value !== null) {
    fail('invalid_event', 'represented_date.value must be null when precision is unresolved');
  }
  return { value: rep.value, precision: rep.precision, provenance: rep.provenance };
}

function validateProposedChanges(targetType, proposedChanges) {
  const allowedFields = {
    document_metadata: ['title', 'category', 'tags', 'valid_until', 'verification_state'],
    claim: ['claim_text', 'verification_state']
  };
  const allowed = allowedFields[targetType];
  if (!allowed) {
    fail('invalid_arguments', `Unsupported target_type in v1: ${targetType}`);
  }
  if (!proposedChanges || typeof proposedChanges !== 'object' || Array.isArray(proposedChanges)) {
    fail('invalid_arguments', 'proposed_changes must be a plain object');
  }
  const keys = Object.keys(proposedChanges);
  if (keys.length === 0 || keys.some(k => !allowed.includes(k))) {
    fail('invalid_arguments', `proposed_changes must be a nonempty subset of [${allowed.join(', ')}] for ${targetType}`);
  }
  if (targetType === 'document_metadata') {
    if ('title' in proposedChanges && (typeof proposedChanges.title !== 'string' || proposedChanges.title.trim().length < 1 || proposedChanges.title.length > 240)) {
      fail('invalid_arguments', 'title must be a nonempty string up to 240 chars');
    }
    if ('category' in proposedChanges && !VALID_CATEGORIES.includes(proposedChanges.category)) {
      fail('invalid_arguments', `category must be one of [${VALID_CATEGORIES.join(', ')}]`);
    }
    if ('tags' in proposedChanges && (!Array.isArray(proposedChanges.tags) || proposedChanges.tags.some(t => typeof t !== 'string'))) {
      fail('invalid_arguments', 'tags must be an array of strings');
    }
    if ('valid_until' in proposedChanges && proposedChanges.valid_until !== null && !isStrictDateTime(proposedChanges.valid_until)) {
      fail('invalid_arguments', 'valid_until must be a valid RFC 3339 / ISO 8601 date-time with timezone or null');
    }
    if ('verification_state' in proposedChanges && !VALID_VERIFICATION_STATES.includes(proposedChanges.verification_state)) {
      fail('invalid_arguments', `verification_state must be one of [${VALID_VERIFICATION_STATES.join(', ')}]`);
    }
  } else if (targetType === 'claim') {
    if ('claim_text' in proposedChanges && (typeof proposedChanges.claim_text !== 'string' || proposedChanges.claim_text.trim().length < 1)) {
      fail('invalid_arguments', 'claim_text must be a nonempty string');
    }
    if ('verification_state' in proposedChanges && !VALID_VERIFICATION_STATES.includes(proposedChanges.verification_state)) {
      fail('invalid_arguments', `verification_state must be one of [${VALID_VERIFICATION_STATES.join(', ')}]`);
    }
  }
}

function extractFieldsFromText(text) {
  const fields = {};
  if (!text) return fields;
  const netPay = text.match(/Net(?:\s+Taxable)?\s+Pay:\s*\$?([\d,]+(?:\.\d{2})?)/i);
  if (netPay) fields.net_pay = parseFloat(netPay[1].replace(/,/g, ''));
  const grossPay = text.match(/Gross\s+Pay:\s*\$?([\d,]+(?:\.\d{2})?)/i);
  if (grossPay) fields.gross_pay = parseFloat(grossPay[1].replace(/,/g, ''));
  const totalAmount = text.match(/Total(?:\s+Due|\s+Amount)?:\s*\$?([\d,]+(?:\.\d{2})?)/i);
  if (totalAmount) fields.total_amount = parseFloat(totalAmount[1].replace(/,/g, ''));
  const policyNum = text.match(/Policy\s*(?:#|No\.?|Number):\s*([A-Z0-9-]+)/i);
  if (policyNum) fields.policy_number = policyNum[1];
  return fields;
}

function decodeAndExtract(contentBase64, mimeType, rawTextOverride) {
  const buffer = Buffer.from(contentBase64, 'base64');
  const sha256 = sha256Hex(buffer);
  const byteSize = buffer.length;

  let rawText = typeof rawTextOverride === 'string' ? rawTextOverride : '';
  let extractionSource = rawTextOverride ? 'FALLBACK_OVERRIDE' : 'UTF8_TEXT';
  let processingStatus = 'READY';

  if (!rawText) {
    if (mimeType === 'text/plain') {
      rawText = buffer.toString('utf8');
      extractionSource = 'UTF8_TEXT';
    } else if (mimeType === 'application/pdf') {
      const ascii = buffer.toString('latin1');
      const matches = [...ascii.matchAll(/\(([^()]{2,200})\)\s*Tj/g)].map(m => m[1]);
      rawText = matches.length ? matches.join('\n') : buffer.toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').trim();
      extractionSource = 'PDF_LOCAL_TEXT';
    } else if (mimeType === 'application/octet-stream') {
      rawText = '';
      extractionSource = 'DEFERRED_RAW';
      processingStatus = 'RAW_ATTACHMENT';
    } else {
      rawText = '';
      extractionSource = 'IMAGE_METADATA_ONLY';
      processingStatus = 'PARSING';
    }
  }

  return {
    sha256,
    byteSize,
    rawText,
    extractedFields: extractFieldsFromText(rawText),
    extractionSource,
    processingStatus
  };
}

function validateSeed(ctx, data) {
  if (!data || typeof data !== 'object') fail('invalid_seed', 'Seed data must be an object');
  if (ctx?.binding?.accounts && !ctx.binding.accounts.some(a => a.app_id === 'personal-records' && a.account_id === data.account_id)) {
    fail('invalid_seed', 'Seed account_id is not bound to personal-records in binding.accounts');
  }
  const docIds = new Set();
  for (const doc of data.documents || []) {
    if (docIds.has(doc.id)) fail('invalid_seed', 'Duplicate document id: ' + doc.id);
    if (doc.account_id !== data.account_id) fail('invalid_seed', 'Document account_id mismatch: ' + doc.id);
    docIds.add(doc.id);
    if (Date.parse(doc.created_at) > Date.parse(doc.updated_at)) {
      fail('invalid_seed', 'Document timestamps reversed: ' + doc.id);
    }
    if (!doc.versions || doc.versions.length === 0) {
      fail('invalid_seed', 'Document must have at least one version: ' + doc.id);
    }
  }
  for (const link of data.links || []) {
    if (link.account_id !== data.account_id) fail('invalid_seed', 'Link account_id mismatch');
    if (!docIds.has(link.source_id) || !docIds.has(link.target_id)) {
      fail('invalid_seed', 'Dangling document link: ' + link.id);
    }
  }
  for (const claim of data.claims || []) {
    if (claim.account_id !== data.account_id) fail('invalid_seed', 'Claim account_id mismatch');
    const doc = data.documents.find(d => d.id === claim.document_id);
    if (!doc) fail('invalid_seed', 'Dangling claim document_id: ' + claim.document_id);
    const ver = doc.versions.find(v => v.version_number === claim.version_number && v.extraction_revision === claim.extraction_revision);
    if (!ver) fail('invalid_seed', 'Claim references missing version/extraction_revision');
    if (claim.start_offset < 0 || claim.end_offset > ver.raw_text.length || claim.start_offset >= claim.end_offset) {
      fail('invalid_seed', 'Claim offset out of bounds: ' + claim.id);
    }
    if (ver.raw_text.slice(claim.start_offset, claim.end_offset) !== claim.cited_text) {
      fail('invalid_seed', 'Claim cited_text does not match extracted text span: ' + claim.id);
    }
  }
}

module.exports = {
  fail,
  sha256Hex,
  isStrictDateTime,
  validateRepresentedDate,
  computeProposalHash,
  computeTargetStateHash,
  validateProposedChanges,
  extractFieldsFromText,
  decodeAndExtract,
  validateSeed,
  records: data => data.documents || [],
  objects: data => (data.documents || []).map(d => d.id),
  references: () => []
};
