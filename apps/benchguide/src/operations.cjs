'use strict';
const { fail, copy, weightedScore } = require('./model.cjs');
const { log } = require('./diagnostics.cjs');

function findProduct(data, productId) {
  const p = data.products.find(x => x.id === productId);
  if (!p) fail('not_found', 'Product not found: ' + productId);
  return p;
}

function handleTool(ctx, data, name, args) {
  if (name === 'benchguide.catalog.search') {
    const dismissedIds = new Set(data.dismissed.map(d => d.product_id));
    const q = (args.query || '').toLocaleLowerCase();
    let list = data.products.filter(p => {
      if (args.category && p.category !== args.category) return false;
      if (args.pick_status && p.pick_status !== args.pick_status) return false;
      if (args.max_price_usd !== undefined && p.price_usd > args.max_price_usd) return false;
      if (args.max_noise_db_high !== undefined && p.metrics.measured_noise_db_high !== null && p.metrics.measured_noise_db_high > args.max_noise_db_high) return false;
      if (args.require_feature && !p.features.includes(args.require_feature)) return false;
      if (args.exclude_dismissed && dismissedIds.has(p.id)) return false;
      if (q) {
        const hay = `${p.id} ${p.name} ${p.category} ${p.summary} ${p.features.join(' ')}`.toLocaleLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).map(p => ({
      ...copy(p),
      weighted_score: weightedScore(p, data.profile.weights),
    }));

    const sortBy = args.sort_by || 'overall';
    if (sortBy === 'weighted') list.sort((a, b) => b.weighted_score - a.weighted_score || a.id.localeCompare(b.id));
    else if (sortBy === 'price_asc') list.sort((a, b) => a.price_usd - b.price_usd || a.id.localeCompare(b.id));
    else list.sort((a, b) => b.metrics.overall_score - a.metrics.overall_score || a.id.localeCompare(b.id));

    log(ctx, 'benchguide.catalog.search', { count: list.length, sort_by: sortBy });
    return { data, result: { items: list } };
  }

  if (name === 'benchguide.review.get') {
    const p = findProduct(data, args.product_id);
    const runId = ctx.run_id || 'demo';
    const resource_uris = (p.asset_ids || []).map(aid => `pale://${runId}/benchguide/assets/${aid}`);
    return { data, result: { product: copy(p), weighted_score: weightedScore(p, data.profile.weights), resource_uris } };
  }

  if (name === 'benchguide.asset.read') {
    const p = findProduct(data, args.product_id);
    if (!p.asset_ids.includes(args.asset_id)) fail('not_available', 'Asset does not belong to this product.');
    if (!ctx.assets?.read) fail('unsupported_capability', 'Asset reader is required.');
    return { data, result: { file: ctx.assets.read(args.asset_id) } };
  }

  if (name === 'benchguide.compare.matrix') {
    const rows = args.product_ids.map(id => {
      const p = findProduct(data, id);
      return {
        product_id: p.id,
        name: p.name,
        category: p.category,
        price_usd: p.price_usd,
        pick_status: p.pick_status,
        features: copy(p.features),
        metrics: copy(p.metrics),
        weighted_score: weightedScore(p, data.profile.weights),
        asset_ids: copy(p.asset_ids),
      };
    });
    const sorted = [...rows].sort((a, b) => b.weighted_score - a.weighted_score || a.product_id.localeCompare(b.product_id));
    return { data, result: { rows, winner_id: sorted[0].product_id } };
  }

  if (name === 'benchguide.profile.get_weights') {
    return { data, result: { profile: copy(data.profile) } };
  }

  if (name === 'benchguide.profile.set_weights') {
    if (!args.weights && !args.constraints) fail('invalid_arguments', 'Provide weights or constraints to update.');
    if (args.weights) {
      const w = args.weights;
      const sum = w.noise_score + w.performance_score + w.reliability_score + w.value_score;
      if (!(sum > 0)) fail('invalid_arguments', 'Weights must sum to a positive value.');
      data.profile.weights = {
        noise_score: Math.round((w.noise_score / sum) * 10000) / 10000,
        performance_score: Math.round((w.performance_score / sum) * 10000) / 10000,
        reliability_score: Math.round((w.reliability_score / sum) * 10000) / 10000,
        value_score: Math.round((w.value_score / sum) * 10000) / 10000,
      };
    }
    if (args.constraints) data.profile.constraints = copy(args.constraints);
    data.profile.updated_at = ctx.virtual_now;
    log(ctx, 'benchguide.profile.set_weights', { updated: true });
    return { data, result: { profile: copy(data.profile) } };
  }

  if (name === 'benchguide.shortlist.list') {
    return { data, result: { shortlist: copy(data.shortlist), dismissed: copy(data.dismissed) } };
  }

  if (name === 'benchguide.shortlist.save') {
    findProduct(data, args.product_id);
    const existing = data.shortlist.find(s => s.product_id === args.product_id);
    if (existing) {
      if (args.note !== undefined) existing.note = args.note;
    } else {
      data.shortlist.push({ product_id: args.product_id, saved_at: ctx.virtual_now, note: args.note || '' });
    }
    log(ctx, 'benchguide.shortlist.save', { product_id: args.product_id });
    return { data, result: { product_id: args.product_id, shortlist_count: data.shortlist.length } };
  }

  if (name === 'benchguide.shortlist.remove') {
    const idx = data.shortlist.findIndex(s => s.product_id === args.product_id);
    if (idx >= 0) data.shortlist.splice(idx, 1);
    return { data, result: { product_id: args.product_id, removed: idx >= 0 } };
  }

  if (name === 'benchguide.shortlist.dismiss') {
    findProduct(data, args.product_id);
    const sIdx = data.shortlist.findIndex(s => s.product_id === args.product_id);
    if (sIdx >= 0) data.shortlist.splice(sIdx, 1);
    const dIdx = data.dismissed.findIndex(d => d.product_id === args.product_id);
    const entry = { product_id: args.product_id, dismissed_at: ctx.virtual_now, reason: args.reason };
    if (dIdx >= 0) data.dismissed[dIdx] = entry;
    else data.dismissed.push(entry);
    log(ctx, 'benchguide.shortlist.dismiss', { product_id: args.product_id });
    return { data, result: { product_id: args.product_id, dismissed_count: data.dismissed.length } };
  }

  fail('unknown_tool', 'Unknown tool: ' + name);
}

module.exports = { handleTool };
