'use strict';

const { assertAccountBinding, fail, parseMs } = require('./common.cjs');

function validateTimeline(records, label, accountId = null) {
  const seen = new Set();
  for (const rec of records) {
    if (seen.has(rec.id)) fail('invalid_seed', `Duplicate ${label} ID: ${rec.id}`);
    seen.add(rec.id);
    if (accountId && rec.account_id !== accountId) {
      fail('invalid_seed', `${label} ${rec.id} does not belong to account ${accountId}`);
    }
    const startTs = rec.created_at || rec.published_at;
    if (parseMs(startTs) > parseMs(rec.updated_at)) {
      fail('invalid_seed', `${label} ${rec.id} timestamps are reversed.`);
    }
    let prev = parseMs(startTs);
    for (const h of rec.history || []) {
      const at = parseMs(h.at);
      if (at < prev || at > parseMs(rec.updated_at)) {
        fail('invalid_seed', `${label} ${rec.id} has out-of-order history.`);
      }
      prev = at;
    }
  }
  return seen;
}

function validateSeed(ctx, data) {
  assertAccountBinding(ctx, data);
  const recallIds = validateTimeline(data.recalls, 'recall');
  const itemIds = validateTimeline(data.inventory, 'inventory', data.account_id);
  validateTimeline(data.watchlists, 'watchlist', data.account_id);
  validateTimeline(data.claims, 'claim', data.account_id);

  for (const claim of data.claims) {
    if (!recallIds.has(claim.recall_id)) {
      fail('invalid_seed', `Claim ${claim.id} references unknown recall ${claim.recall_id}`);
    }
    if (!itemIds.has(claim.item_id)) {
      fail('invalid_seed', `Claim ${claim.id} references unknown inventory item ${claim.item_id}`);
    }
  }
}

function records(data) {
  return [...data.recalls, ...data.inventory, ...data.watchlists, ...data.claims];
}

function objects(data) {
  return records(data).map((r) => r.id);
}

function references() {
  return [];
}

function assetReferences(data) {
  const refs = [];
  for (const recall of data.recalls) {
    if (recall.label_asset_id) {
      refs.push({
        asset_id: recall.label_asset_id,
        object_id: recall.id,
        object_type: 'recall_notice',
      });
    }
  }
  return refs;
}

module.exports = {
  validateSeed,
  records,
  objects,
  references,
  assetReferences,
};
