'use strict';
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function copy(v) { return structuredClone(v); }

function weightedScore(product, weights) {
  const m = product.metrics;
  const sum = weights.noise_score + weights.performance_score + weights.reliability_score + weights.value_score;
  if (!(sum > 0)) fail('invalid_arguments', 'Weight vector sum must be positive.');
  const raw = (
    m.noise_score * weights.noise_score +
    m.performance_score * weights.performance_score +
    m.reliability_score * weights.reliability_score +
    m.value_score * weights.value_score
  ) / sum;
  return Math.round(raw * 100) / 100;
}

function validateSeed(ctx, data) {
  const accOk = ctx.binding.accounts.some(a => a.app_id === 'benchguide' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!accOk) fail('invalid_seed', 'Account or owner_person_id not bound in task binding.');
  const seen = new Set();
  for (const p of data.products) {
    if (seen.has(p.id)) fail('invalid_seed', 'Duplicate product ID: ' + p.id);
    seen.add(p.id);
    if (Date.parse(p.published_at) > Date.parse(p.updated_at)) fail('invalid_seed', 'Reversed product timestamps.');
  }
  const w = data.profile.weights;
  const wSum = w.noise_score + w.performance_score + w.reliability_score + w.value_score;
  if (!Number.isFinite(wSum) || wSum <= 0) fail('invalid_seed', 'Profile weights must sum to > 0.');
  const slSeen = new Set();
  for (const s of data.shortlist) {
    if (!seen.has(s.product_id) || slSeen.has(s.product_id)) fail('invalid_seed', 'Invalid or duplicate shortlist product_id.');
    slSeen.add(s.product_id);
  }
  const dmSeen = new Set();
  for (const d of data.dismissed) {
    if (!seen.has(d.product_id) || dmSeen.has(d.product_id)) fail('invalid_seed', 'Invalid or duplicate dismissed product_id.');
    dmSeen.add(d.product_id);
  }
}

function assetReferences(data) {
  return data.products.flatMap(p =>
    [...new Set(p.asset_ids || [])].map(asset_id => ({ asset_id, object_id: p.id, object_type: 'product' }))
  );
}

module.exports = {
  fail,
  copy,
  weightedScore,
  validateSeed,
  records: data => data.products,
  objects: data => data.products.map(p => p.id),
  references: () => [],
  assetReferences,
};
