#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const SESSION_CUTOFF_DAY = '2026-11-17';
const SESSION_CUTOFF_MONTH = '2026-11';
const FIRST_SESSION_AT = '2026-11-18T09:00:00-08:00';
const SYNTHETIC_INGESTION_AT = '2026-11-18T08:59:00-08:00';

function isStrictlyPreSession(timestamp, firstSessionAt = FIRST_SESSION_AT) {
  return Date.parse(timestamp) < Date.parse(firstSessionAt);
}

function parseRepresentedDate(text) {
  const str = String(text || '');
  const dayMatch = str.match(/(?:Date|Period|Deposit Date|Effective Date|Issued):\s*(\d{4}-\d{2}-\d{2})\b/i);
  if (dayMatch) {
    return {
      value: dayMatch[1],
      precision: 'day',
      provenance: 'extracted_from_text',
      month_key: dayMatch[1].slice(0, 7)
    };
  }
  const monthMatch = str.match(/(?:Date|Period|Deposit Date|Effective Date|Issued):\s*(\d{4}-\d{2})\b/i);
  if (monthMatch) {
    return {
      value: monthMatch[1],
      precision: 'month',
      provenance: 'extracted_from_text',
      month_key: monthMatch[1]
    };
  }
  return {
    value: null,
    precision: 'unresolved',
    provenance: 'none_in_source_text',
    month_key: null
  };
}

function isPostCutoff(rep) {
  if (rep.precision === 'day') return rep.value > SESSION_CUTOFF_DAY;
  if (rep.precision === 'month') return rep.value > SESSION_CUTOFF_MONTH;
  return false;
}

function availabilityTimestampFor(rep) {
  if (!isPostCutoff(rep)) return SYNTHETIC_INGESTION_AT;
  return rep.precision === 'day' ? `${rep.value}T09:00:00-08:00` : `${rep.value}-28T09:00:00-08:00`;
}

function convertFixtureToPaleSeed(sourcePath, { accountId = 'records-maya', ownerPersonId = 'person-maya', timeZone = 'America/Los_Angeles' } = {}) {
  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const documents = [];
  const claims = [];
  const links = [];
  const stagedEvents = [];

  const inWindowByMonth = {};
  const preWindowByMonth = {};
  const precisionCounts = { day: 0, month: 0, unresolved: 0 };
  let inWindowCount = 0;
  let preWindowCount = 0;
  let unresolvedCount = 0;

  for (const [idx, item] of (raw.documents || []).entries()) {
    const id = item.fixture_id || `doc_${idx + 1}`;
    const text = item.content_text || '';
    const buf = Buffer.from(text, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const rep = parseRepresentedDate(text);

    precisionCounts[rep.precision] += 1;
    if (rep.precision === 'unresolved') {
      unresolvedCount += 1;
    } else if (rep.month_key < '2025-01') {
      preWindowCount += 1;
      preWindowByMonth[rep.month_key] = (preWindowByMonth[rep.month_key] || 0) + 1;
    } else if (rep.month_key <= '2026-12') {
      inWindowCount += 1;
      inWindowByMonth[rep.month_key] = (inWindowByMonth[rep.month_key] || 0) + 1;
    }

    const availableAt = availabilityTimestampFor(rep);

    if (isPostCutoff(rep)) {
      stagedEvents.push({
        event_id: `evt_staged_${id}`,
        at: availableAt,
        operation: 'personal-records.inject_document',
        payload: {
          id,
          title: item.title,
          category: item.category || 'other',
          tags: item.tags || [],
          mime_type: item.mime_type || 'text/plain',
          content_bytes: buf.toString('base64'),
          raw_text: text,
          valid_until: item.valid_until || null,
          source: 'staged_corpus_availability',
          represented_date: {
            value: rep.value,
            precision: rep.precision,
            provenance: rep.provenance
          }
        }
      });
      continue;
    }

    documents.push({
      id,
      account_id: accountId,
      title: item.title,
      category: item.category || 'other',
      tags: item.tags || [],
      current_version_number: 1,
      processing_status: 'READY',
      verification_state: 'INFERRED',
      valid_until: item.valid_until || null,
      source_type: 'SYNTHETIC_CORPUS',
      source_reference: {
        dataset_id: 'personal-records-synthetic-2025-2026',
        source_id: 'synthetic-generator',
        scenario_id: raw.scenario_id,
        fixture_id: id,
        represented_date: {
          value: rep.value,
          precision: rep.precision,
          provenance: rep.provenance
        },
        ingested_at: availableAt,
        ingestion_provenance: 'synthetic_availability_before_session'
      },
      created_at: availableAt,
      updated_at: availableAt,
      history: [{ at: availableAt, action: 'seeded_from_corpus' }],
      versions: [
        {
          version_number: 1,
          sha256,
          mime_type: item.mime_type || 'text/plain',
          byte_size: buf.length,
          content_base64: buf.toString('base64'),
          change_summary: null,
          extraction_revision: 'ext_rev_01',
          extraction_source: 'UTF8_TEXT',
          raw_text: text,
          extracted_fields: item.expected_fields || {},
          created_at: availableAt
        }
      ]
    });

    for (const [sIdx, span] of (item.evidence_spans || []).entries()) {
      if (span.start >= 0 && span.end <= text.length && text.slice(span.start, span.end) === span.text) {
        claims.push({
          id: `clm_${id}_${sIdx + 1}`,
          account_id: accountId,
          document_id: id,
          version_number: 1,
          extraction_revision: 'ext_rev_01',
          start_offset: span.start,
          end_offset: span.end,
          cited_text: span.text,
          claim_text: `${span.label}: ${span.text}`,
          verification_state: 'INFERRED',
          created_at: availableAt
        });
      }
    }
  }

  for (const [lIdx, lnk] of (raw.links || []).entries()) {
    if (documents.some(d => d.id === lnk.source_id) && documents.some(d => d.id === lnk.target_id)) {
      links.push({
        id: `lnk_corpus_${lIdx + 1}`,
        account_id: accountId,
        source_id: lnk.source_id,
        target_id: lnk.target_id,
        relationship_type: lnk.relationship_type,
        metadata: lnk.metadata || {},
        created_at: SYNTHETIC_INGESTION_AT
      });
    }
  }

  stagedEvents.sort((a, b) => a.at.localeCompare(b.at) || a.event_id.localeCompare(b.event_id));
  const sortMap = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

  return {
    data: {
      account_id: accountId,
      owner_person_id: ownerPersonId,
      documents,
      links,
      claims,
      proposals: [],
      notifications: []
    },
    staged_events: stagedEvents,
    binding: {
      people: [{ person_id: ownerPersonId, name: 'Maya Chen' }],
      accounts: [{ app_id: 'personal-records', account_id: accountId, owner_person_id: ownerPersonId }],
      objects: { 'personal-records': documents.map(d => d.id) }
    },
    summary: {
      scenario_id: raw.scenario_id,
      timezone: timeZone,
      first_session_at: FIRST_SESSION_AT,
      pre_session_availability_at: SYNTHETIC_INGESTION_AT,
      pre_session_documents: documents.length,
      staged_post_cutoff_events: stagedEvents.length,
      claims: claims.length,
      links: links.length,
      date_coverage: {
        in_window_2025_2026: inWindowCount,
        pre_window_before_2025: preWindowCount,
        unresolved_dates: unresolvedCount,
        precision: precisionCounts
      },
      in_window_by_month: sortMap(inWindowByMonth),
      pre_window_by_month: sortMap(preWindowByMonth)
    }
  };
}

if (require.main === module) {
  const sourceArg = process.argv.includes('--truth') ? 'truth.json' : 'corpus.json';
  const sourcePath = path.resolve(__dirname, '../fixtures', sourceArg);
  const converted = convertFixtureToPaleSeed(sourcePath);

  if (process.argv.includes('--verify-load')) {
    const root = path.resolve(__dirname, '../../..');
    const { prepare } = require(path.join(root, 'runtime/prepare.cjs'));
    const { createRuntime } = require(path.join(root, 'runtime/core/runtime.cjs'));
    const prep = prepare(path.resolve(__dirname, '..'));
    try {
      const rt = createRuntime({ registryFile: prep.registry });
      const s0 = rt.create('personal-records', 'corpus-load', 'scenario');
      const loaded = rt.execute(s0, 'infra', 'env.load_seed', {
        expected_version: rt.version(s0),
        request_id: 'load-' + sourceArg,
        data: converted.data,
        binding: converted.binding
      });
      assert.equal(loaded.result.status, 'ready');

      // Verify every initially loaded record is strictly before FIRST_SESSION_AT (<, excluding equality)
      assert.equal(isStrictlyPreSession(FIRST_SESSION_AT, FIRST_SESSION_AT), false, 'Equality must be excluded from strict pre-session filter');
      for (const doc of loaded.state.data.documents) {
        assert.equal(isStrictlyPreSession(doc.created_at, FIRST_SESSION_AT), true, `Document ${doc.id} is not strictly pre-session`);
        assert.equal(isStrictlyPreSession(doc.source_reference.ingested_at, FIRST_SESSION_AT), true, `Document ${doc.id} ingested_at is not strictly pre-session`);
      }

      // Verify post-cutoff completed transactions are NOT visible in pre-session snapshot
      const preSearch = rt.execute(loaded.state, 'agent', 'personal-records.search', { limit: 50 });
      const preIds = new Set(loaded.state.data.documents.map(d => d.id));
      for (const ev of converted.staged_events) {
        assert.equal(isStrictlyPreSession(ev.at, FIRST_SESSION_AT), false, `Staged event ${ev.event_id} must not be pre-session`);
        assert.equal(preIds.has(ev.payload.id), false, `Post-cutoff record ${ev.payload.id} leaked into pre-session snapshot`);
      }

      // Apply staged events at their simulated availability times and verify visibility
      let state = loaded.state;
      for (const ev of converted.staged_events) {
        const applied = rt.execute(state, 'infra', 'env.apply_event', {
          expected_version: rt.version(state),
          event: ev
        });
        assert.equal(applied.result.status, 'committed', `Failed staged event ${ev.event_id}: ${applied.result.message}`);
        state = applied.state;
      }

      const postPayslips = rt.execute(state, 'agent', 'personal-records.search', { query: 'Payslip', limit: 50 });
      for (const ev of converted.staged_events) {
        const found = rt.execute(state, 'agent', 'personal-records.get_document', { id: ev.payload.id });
        assert.equal(found.result.status, 'ok', `Staged document ${ev.payload.id} missing after simulated availability`);
      }

      console.log(JSON.stringify({
        loaded_status: loaded.result.status,
        pre_session_loaded_objects: loaded.result.loaded,
        pre_session_search_sample: preSearch.result.total,
        post_staged_documents: state.data.documents.length,
        post_staged_payslip_total: postPayslips.result.total,
        ...converted.summary
      }, null, 2));
    } finally {
      prep.cleanup();
    }
  } else {
    console.log(JSON.stringify(converted.summary, null, 2));
  }
}

module.exports = { convertFixtureToPaleSeed, isStrictlyPreSession, FIRST_SESSION_AT, SYNTHETIC_INGESTION_AT };
