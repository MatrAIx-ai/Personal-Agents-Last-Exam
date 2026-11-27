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

function computeProposalHash({ target_type, target_id, expected_version, proposed_changes }) {
  const canonical = JSON.stringify({
    target_type,
    target_id,
    expected_version: expected_version ?? null,
    proposed_changes: proposed_changes || {}
  });
  return sha256Hex(Buffer.from(canonical, 'utf8'));
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
  computeProposalHash,
  extractFieldsFromText,
  decodeAndExtract,
  validateSeed,
  records: data => data.documents || [],
  objects: data => (data.documents || []).map(d => d.id),
  references: () => []
};
