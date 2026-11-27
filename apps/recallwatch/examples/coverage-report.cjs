'use strict';

// Reproducible Environment dataset coverage report (per docs/submission-evidence.md §3).
// Computes SHA-256 hashes, per-collection counts, monthly breakdown (2025-01..2026-12),
// global deduplicated distinct-date count in UTC, and verifies live MCP env.load_seed + queries.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '../../..');
const { Client } = require(path.join(repoRoot, 'runtime/client.cjs'));
const { prepare } = require(path.join(repoRoot, 'runtime/prepare.cjs'));

const TIMEZONE = 'UTC';
const WINDOW_START = '2025-01-01';
const WINDOW_END = '2026-12-31';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function toUtcDate(isoOrDate) {
  if (!isoOrDate || typeof isoOrDate !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) return isoOrDate;
  const ms = Date.parse(isoOrDate);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function analyzeDataset(relPath) {
  const fullPath = path.join(repoRoot, relPath);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const specs = [
    ['recalls', 'published_at'],
    ['inventory', 'created_at'],
    ['watchlists', 'created_at'],
    ['claims', 'created_at'],
  ];

  const perCollection = {};
  const monthly = {};
  for (const yr of [2025, 2026]) {
    for (let m = 1; m <= 12; m++) {
      monthly[`${yr}-${String(m).padStart(2, '0')}`] = { records: 0, distinct_dates: new Set() };
    }
  }
  const globalDates = new Set();
  const excluded = [];
  let totalRecords = 0;

  for (const [col, field] of specs) {
    const dates = new Set();
    let count = 0;
    for (const rec of data[col] || []) {
      totalRecords++;
      count++;
      const d = toUtcDate(rec[field]);
      if (!d || d < WINDOW_START || d > WINDOW_END) {
        excluded.push({ collection: col, id: rec.id, field, value: rec[field] || null, reason: 'outside_window' });
        continue;
      }
      dates.add(d);
      globalDates.add(d);
      const ym = d.slice(0, 7);
      if (monthly[ym]) {
        monthly[ym].records++;
        monthly[ym].distinct_dates.add(d);
      }
    }
    perCollection[col] = {
      record_count: count,
      authoritative_date_field: field,
      distinct_dates: dates.size,
    };
  }

  const sortedDates = [...globalDates].sort();
  const monthlySummary = {};
  const gaps = [];
  for (const [ym, info] of Object.entries(monthly)) {
    monthlySummary[ym] = { records: info.records, distinct_dates: info.distinct_dates.size };
    if (info.records === 0) gaps.push(ym);
  }

  return {
    file: relPath,
    sha256: sha256File(fullPath),
    provenance: '100% synthetic (authored)',
    timezone: TIMEZONE,
    window: { start: WINDOW_START, end: WINDOW_END },
    total_records: totalRecords,
    per_collection: perCollection,
    global_deduplicated_distinct_dates: sortedDates.length,
    earliest_date: sortedDates[0] || null,
    latest_date: sortedDates[sortedDates.length - 1] || null,
    excluded_records: excluded,
    missing_months: gaps,
    monthly_breakdown: monthlySummary,
  };
}

async function verifyLiveMcpLoad(relPath) {
  const fullPath = path.join(repoRoot, relPath);
  const fullData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-rw-cov-'));
  const prepared = prepare(path.join(repoRoot, 'apps/recallwatch'), []);
  const clients = [];
  try {
    const infra = new Client('recallwatch', 'infra', 'rw-cov-run', dir, 'cov-infra', { registry: prepared.registry });
    const agent = new Client('recallwatch', 'agent', 'rw-cov-run', dir, 'cov-agent', { registry: prepared.registry, profile: 'sandbox' });
    clients.push(infra, agent);
    await Promise.all(clients.map((c) => c.initialize()));

    const snap0 = await infra.call('env.snapshot', {});
    const loaded = await infra.call('env.load_seed', { expected_version: snap0.version, data: fullData });
    assert.equal(loaded.status, 'ready');

    const recalls = await agent.call('recallwatch.recall.search', {});
    const inv = await agent.call('recallwatch.inventory.list', { include_archived: true });
    const claims = await agent.call('recallwatch.claim.list', {});
    assert.equal(recalls.status, 'ok');
    assert.equal(recalls.items.length, fullData.recalls.length);
    assert.equal(inv.items.length, fullData.inventory.length);
    assert.equal(claims.items.length, fullData.claims.length);

    return {
      load_seed_status: loaded.status,
      loaded_version: loaded.version,
      mcp_query_counts: {
        recalls: recalls.items.length,
        inventory: inv.items.length,
        claims: claims.items.length,
      },
      representative_records: {
        earliest_2025_recall: recalls.items.find((r) => r.id === 'RW-2025-H100'),
        late_2026_recall: recalls.items.find((r) => r.id === 'RW-2026-H411'),
      },
    };
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
    prepared.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const minimal = analyzeDataset('apps/recallwatch/fixtures/minimal.json');
  const fullWindow = analyzeDataset('apps/recallwatch/fixtures/full-window.json');
  const liveLoad = await verifyLiveMcpLoad('apps/recallwatch/fixtures/full-window.json');
  const report = { minimal_fixture: minimal, full_window_dataset: fullWindow, live_mcp_load_verification: liveLoad };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
