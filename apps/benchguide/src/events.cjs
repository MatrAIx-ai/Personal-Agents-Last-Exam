'use strict';
const { fail, copy } = require('./model.cjs');
const { log } = require('./diagnostics.cjs');

const VALID_PICK_STATUSES = new Set(['top_pick', 'recommended', 'budget_pick', 'downgraded', 'none']);

function applyEvent(ctx, data, event) {
  if (event.operation === 'benchguide.review.revise') {
    const pl = event.payload;
    const product = data.products.find(p => p.id === pl.product_id);
    if (!product) fail('invalid_event', 'Unknown product_id in review.revise: ' + pl.product_id);
    if (!pl.revision_id || !pl.new_pick_status || !pl.summary) fail('invalid_event', 'Missing required fields in review.revise.');
    if (!VALID_PICK_STATUSES.has(pl.new_pick_status)) fail('invalid_event', 'Invalid new_pick_status: ' + pl.new_pick_status);
    if (product.revisions.some(r => r.revision_id === pl.revision_id)) fail('invalid_event', 'Duplicate revision_id: ' + pl.revision_id);
    if (Date.parse(event.at) < Date.parse(product.updated_at)) fail('invalid_event', 'Revision time cannot precede product updated_at.');
    if (pl.metric_updates !== undefined) {
      if (!pl.metric_updates || typeof pl.metric_updates !== 'object' || Array.isArray(pl.metric_updates)) {
        fail('invalid_event', 'metric_updates must be an object.');
      }
      for (const [k, v] of Object.entries(pl.metric_updates)) {
        if (!(k in product.metrics)) fail('invalid_event', 'Unknown metric field: ' + k);
        if (typeof v !== 'number' || !Number.isFinite(v)) fail('invalid_event', 'Metric value must be a finite number: ' + k);
      }
    }
    if (pl.add_asset_id !== undefined) {
      if (typeof pl.add_asset_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(pl.add_asset_id)) {
        fail('invalid_event', 'Invalid add_asset_id format.');
      }
    }

    product.pick_status = pl.new_pick_status;
    product.updated_at = event.at;
    if (pl.metric_updates) {
      for (const [k, v] of Object.entries(pl.metric_updates)) {
        product.metrics[k] = v;
      }
    }
    if (pl.add_asset_id && !product.asset_ids.includes(pl.add_asset_id)) {
      product.asset_ids.push(pl.add_asset_id);
    }
    product.revisions.push({
      revision_id: pl.revision_id,
      published_at: pl.published_at || event.at,
      pick_status: pl.new_pick_status,
      summary: pl.summary,
    });
    log(ctx, 'benchguide.event.review_revise', { product_id: product.id, revision_id: pl.revision_id });
    return data;
  }

  if (event.operation === 'benchguide.catalog.publish') {
    const item = copy(event.payload);
    if (!item.id || data.products.some(p => p.id === item.id)) fail('invalid_event', 'Missing or duplicate product ID in catalog.publish.');
    data.products.push(item);
    log(ctx, 'benchguide.event.catalog_publish', { product_id: item.id });
    return data;
  }

  fail('invalid_event', 'Unsupported operation: ' + event.operation);
}

module.exports = { applyEvent };
