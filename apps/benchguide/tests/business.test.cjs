'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { compile } = require('./schema-validator.cjs');
const { fixture } = require('./harness.cjs');

test('weighted search re-ranks bedroom air purifiers below 58 dB above louder Top Pick and returns MCP resource URIs', () => {
  const f = fixture();
  const overall = f.call('benchguide.catalog.search', { category: 'air_purifier', sort_by: 'overall' }).items;
  assert.equal(overall[0].id, 'purifier-clearair-x9');
  assert.equal(overall[0].metrics.overall_score, 9.2);

  const weighted = f.call('benchguide.catalog.search', {
    category: 'air_purifier',
    max_noise_db_high: 58,
    sort_by: 'weighted',
  }).items;
  assert.equal(weighted[0].id, 'purifier-pureleaf-s1');
  assert.equal(weighted[0].metrics.measured_noise_db_high, 52);
  assert.ok(weighted.every(p => p.metrics.measured_noise_db_high === null || p.metrics.measured_noise_db_high <= 58));

  const detail = f.call('benchguide.review.get', { product_id: 'purifier-clearair-x9' });
  assert.deepEqual(detail.resource_uris, ['pale://demo/benchguide/assets/asset-chart-purifier-clearair-x9']);
});

test('asset.read returns verified lab chart PNG magic header and rejects cross-product asset access', () => {
  const f = fixture();
  const res = f.call('benchguide.asset.read', {
    product_id: 'purifier-clearair-x9',
    asset_id: 'asset-chart-purifier-clearair-x9',
  });
  assert.equal(res.file.mime_type, 'image/png');
  const raw = Buffer.from(res.file.base64, 'base64');
  assert.ok(raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.throws(() => f.call('benchguide.asset.read', {
    product_id: 'purifier-pureleaf-s1',
    asset_id: 'asset-chart-purifier-clearair-x9',
  }), { code: 'not_available' });
});

test('compare.matrix computes weighted winner across 2-4 products', () => {
  const f = fixture();
  const cmp = f.call('benchguide.compare.matrix', {
    product_ids: ['purifier-clearair-x9', 'purifier-pureleaf-s1'],
  });
  assert.equal(cmp.rows.length, 2);
  assert.equal(cmp.winner_id, 'purifier-pureleaf-s1');
});

test('review.revise event downgrades Top Pick, preserves immutable history, and rejects invalid revisions atomically', () => {
  const f = fixture();
  const scenario = require('../examples/scenario.json');
  f.event(scenario);
  const vac = f.call('benchguide.review.get', { product_id: 'vac-aeroglide-s4' }).product;
  assert.equal(vac.pick_status, 'downgraded');
  assert.equal(vac.metrics.reliability_score, 4.8);
  assert.equal(vac.metrics.overall_score, 7.1);
  assert.equal(vac.revisions.length, 2);
  assert.equal(vac.revisions[0].revision_id, 'rev_1');
  assert.equal(vac.revisions[1].revision_id, 'rev_2');

  const snapshot = f.data;
  // Duplicate revision_id
  assert.throws(() => f.event(scenario), { code: 'invalid_event' });
  // Unknown metric key
  assert.throws(() => f.event({
    event_id: 'rev-bad-metric',
    at: '2026-11-19T09:10:00-08:00',
    operation: 'benchguide.review.revise',
    payload: {
      product_id: 'vac-aeroglide-s4',
      revision_id: 'rev_3',
      new_pick_status: 'downgraded',
      summary: 'Bad metric test',
      metric_updates: { nonexistent_score: 5.0 },
    },
  }), { code: 'invalid_event' });
  // Backwards timestamp
  assert.throws(() => f.event({
    event_id: 'rev-backwards-ts',
    at: '2026-11-17T09:10:00-08:00',
    operation: 'benchguide.review.revise',
    payload: {
      product_id: 'vac-aeroglide-s4',
      revision_id: 'rev_4',
      new_pick_status: 'downgraded',
      summary: 'Backwards timestamp test',
    },
  }), { code: 'invalid_event' });
  assert.deepEqual(f.data, snapshot);
});

test('review.revise add_asset_id syncs review.get resource_uris and assetReferences, and catalog.publish rejects duplicates', () => {
  const f = fixture();
  f.event({
    event_id: 'rev-add-chart-v2',
    at: '2026-11-19T10:00:00-08:00',
    operation: 'benchguide.review.revise',
    payload: {
      product_id: 'purifier-pureleaf-s1',
      revision_id: 'rev_2',
      published_at: '2026-11-19T09:55:00-08:00',
      new_pick_status: 'top_pick',
      summary: 'Retested acoustic sweep confirmed 52 dB High mode; promoted to Top Pick.',
      add_asset_id: 'asset-chart-purifier-pureleaf-s1-v2',
    },
  });
  const detail = f.call('benchguide.review.get', { product_id: 'purifier-pureleaf-s1' });
  assert.ok(detail.product.asset_ids.includes('asset-chart-purifier-pureleaf-s1-v2'));
  assert.ok(detail.resource_uris.includes('pale://demo/benchguide/assets/asset-chart-purifier-pureleaf-s1-v2'));
  const refs = plugin.assetReferences(f.data);
  assert.ok(refs.some(r => r.object_id === 'purifier-pureleaf-s1' && r.asset_id === 'asset-chart-purifier-pureleaf-s1-v2'));

  // Duplicate product ID in catalog.publish rejects atomically
  assert.throws(() => f.event({
    event_id: 'pub-dup-1',
    at: '2026-11-19T11:00:00-08:00',
    operation: 'benchguide.catalog.publish',
    payload: f.data.products[0],
  }), { code: 'invalid_event' });
});

test('shortlist save is idempotent, dismiss removes from shortlist, and multipoint_bluetooth filter works', () => {
  const f = fixture();
  const s1 = f.call('benchguide.shortlist.save', { product_id: 'purifier-hushflow-p4', note: 'first' });
  const s2 = f.call('benchguide.shortlist.save', { product_id: 'purifier-hushflow-p4', note: 'updated' });
  assert.equal(s1.shortlist_count, s2.shortlist_count);

  const mp = f.call('benchguide.catalog.search', {
    category: 'anc_headphones',
    require_feature: 'multipoint_bluetooth',
  }).items;
  assert.ok(mp.some(x => x.id === 'hp-skycalm-pro'));
  assert.ok(!mp.some(x => x.id === 'hp-soniclift-a5'));

  f.call('benchguide.shortlist.dismiss', { product_id: 'hp-soniclift-a5', reason: 'No multipoint Bluetooth' });
  const sl = f.call('benchguide.shortlist.list');
  assert.ok(!sl.shortlist.some(x => x.product_id === 'hp-soniclift-a5'));
  assert.equal(sl.dismissed.length, 1);
  const filtered = f.call('benchguide.catalog.search', { category: 'anc_headphones', exclude_dismissed: true }).items;
  assert.ok(!filtered.some(x => x.id === 'hp-soniclift-a5'));
});

test('set_weights normalizes valid weights and rejects zero-sum weights without mutation', () => {
  const f = fixture();
  const before = f.data;
  assert.throws(() => f.call('benchguide.profile.set_weights', {
    weights: { noise_score: 0, performance_score: 0, reliability_score: 0, value_score: 0 },
  }), { code: 'invalid_arguments' });
  assert.deepEqual(f.data, before);
  const updated = f.call('benchguide.profile.set_weights', {
    weights: { noise_score: 0.2, performance_score: 0.6, reliability_score: 0.1, value_score: 0.1 },
  });
  assert.equal(updated.profile.weights.performance_score, 0.6);
});

test('second household seed (seed-value.json) validates cleanly and prioritizes value picks', () => {
  const root = path.resolve(__dirname, '..');
  const seedValidator = compile(JSON.parse(fs.readFileSync(path.join(root, 'schemas/seed.schema.json'), 'utf8')), path.join(root, 'schemas'));
  const valueSeed = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/seed-value.json'), 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/binding.json'), 'utf8'));
  assert.equal(seedValidator(valueSeed), true);
  plugin.validateSeed({ binding }, valueSeed);

  const ranked = plugin.handleTool(
    { app_id: 'benchguide', run_id: 'test-val', virtual_now: '2026-11-18T09:00:00-08:00', binding },
    valueSeed,
    'benchguide.catalog.search',
    { category: 'air_purifier', max_price_usd: 280, sort_by: 'weighted' }
  ).result.items;
  assert.equal(ranked[0].id, 'purifier-pureleaf-s1');
  assert.ok(ranked.every(p => p.price_usd <= 280));
});

test('evaluation visual-cues manifest covers all 20 catalog PNG charts with exact SHA-256 hashes', () => {
  const root = path.resolve(__dirname, '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'contribution/assets.catalog.json'), 'utf8'));
  const cues = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-cues.eval.json'), 'utf8'));
  assert.equal(cues.visibility, 'evaluation_only_never_exposed_to_agent');
  assert.equal(cues.cues.length, catalog.assets.length);
  for (const asset of catalog.assets) {
    const cue = cues.cues.find(c => c.asset_id === asset.asset_id);
    assert.ok(cue, 'Missing visual cue for ' + asset.asset_id);
    assert.equal(cue.sha256, asset.integrity.sha256, 'SHA-256 mismatch for ' + asset.asset_id);
    assert.equal(cue.path, asset.storage.path);
    assert.equal(cue.manually_checked, true);
  }
  const trap = cues.cues.find(c => c.product_id === 'purifier-clearair-x9');
  assert.equal(trap.high_mode_db, 71);
  assert.equal(trap.bedroom_noise_safe, false);
  assert.equal(trap.visual_trap, 'marketing_quiet_claim_vs_71db_spike');
  const winner = cues.cues.find(c => c.product_id === 'purifier-pureleaf-s1');
  assert.equal(winner.high_mode_db, 52);
  assert.equal(winner.bedroom_noise_safe, true);
});

test('matched visual-only A/B swap fixtures keep text, structured winner, IDs, order, and metadata identical while swapping only 57 dB vs 59 dB PNG bytes', () => {
  const root = path.resolve(__dirname, '..');
  const seedA = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-blind-a.json'), 'utf8'));
  const seedB = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-blind-b.json'), 'utf8'));
  assert.deepEqual(seedA, seedB, 'Fixture A and Fixture B seed JSON must be identical');

  const bundleA = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-blind-a.bundle.json'), 'utf8'));
  const bundleB = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-blind-b.bundle.json'), 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/binding.json'), 'utf8'));

  // Structured compare.matrix winner stays fixed on purifier-calmair-m5 in both A and B
  const cmpA = plugin.handleTool({ app_id: 'benchguide', run_id: 'swap-a', virtual_now: '2026-11-18T09:00:00-08:00', binding }, seedA, 'benchguide.compare.matrix', { product_ids: ['purifier-calmair-m5', 'purifier-quietmist-m6'] }).result;
  const cmpB = plugin.handleTool({ app_id: 'benchguide', run_id: 'swap-b', virtual_now: '2026-11-18T09:00:00-08:00', binding }, seedB, 'benchguide.compare.matrix', { product_ids: ['purifier-calmair-m5', 'purifier-quietmist-m6'] }).result;
  assert.deepEqual(cmpA, cmpB);
  assert.equal(cmpA.winner_id, 'purifier-calmair-m5');
  assert.equal(cmpA.rows[0].metrics.measured_noise_db_high, null);
  assert.equal(cmpA.rows[1].metrics.measured_noise_db_high, null);
  assert.equal(cmpA.rows[0].weighted_score, cmpA.rows[1].weighted_score);

  // Asset metadata (ID, path, mime_type, alt_text, dimensions, and byte size) is identical across A and B; only PNG bytes/SHA swap
  const idM5 = 'asset-chart-purifier-calmair-m5';
  const idM6 = 'asset-chart-purifier-quietmist-m6';
  const metaA5 = bundleA.catalog.assets.find(x => x.asset_id === idM5);
  const metaA6 = bundleA.catalog.assets.find(x => x.asset_id === idM6);
  const metaB5 = bundleB.catalog.assets.find(x => x.asset_id === idM5);
  const metaB6 = bundleB.catalog.assets.find(x => x.asset_id === idM6);

  assert.equal(metaA5.presentation.alt_text, metaA6.presentation.alt_text);
  assert.equal(metaA5.presentation.alt_text, metaB5.presentation.alt_text);
  assert.ok(!metaA5.presentation.alt_text.includes('57') && !metaA5.presentation.alt_text.includes('59'));
  assert.equal(metaA5.integrity.bytes, metaA6.integrity.bytes);
  assert.equal(metaA5.integrity.bytes, metaB5.integrity.bytes);
  assert.equal(metaA6.integrity.bytes, metaB6.integrity.bytes);
  assert.equal(metaA5.storage.path, metaB5.storage.path);
  assert.equal(metaA6.storage.path, metaB6.storage.path);

  // Verify exact PNG blob swap between A and B
  assert.notEqual(bundleA.blobs[idM5], bundleA.blobs[idM6]);
  assert.equal(bundleA.blobs[idM5], bundleB.blobs[idM6]);
  assert.equal(bundleA.blobs[idM6], bundleB.blobs[idM5]);
  assert.equal(metaA5.integrity.sha256, metaB6.integrity.sha256);
  assert.equal(metaA6.integrity.sha256, metaB5.integrity.sha256);

  const cues = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-cues.eval.json'), 'utf8'));
  assert.equal(cues.swap_control.fixture_a.image_on_expected_winner_id, 'purifier-calmair-m5');
  assert.equal(cues.swap_control.fixture_b.image_on_expected_winner_id, 'purifier-quietmist-m6');
  assert.equal(cues.swap_control.fixture_a.image_off_expected, 'insufficient_evidence');
  assert.equal(cues.swap_control.fixture_b.image_off_expected, 'insufficient_evidence');
});

test('24-month evaluation dataset (eval-2025-2026.json) covers 2025-01-01 through 2026-12-31 across all 24 months', () => {
  const { report } = require('../scripts/coverage-report.cjs');
  assert.equal(report.counting_time_zone, 'America/Los_Angeles');
  assert.equal(report.earliest_date, '2025-01-01');
  assert.equal(report.latest_date, '2026-12-31');
  assert.equal(report.months_covered, 24);
  assert.equal(report.load_and_query_check.schema_valid, true);
});
