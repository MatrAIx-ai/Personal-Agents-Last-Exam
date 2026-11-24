'use strict';
// Neutral reusable example inputs. No private history or Task answer is read.
const clone = value => structuredClone(value);
const later = (instant, milliseconds) => new Date(Date.parse(instant) + milliseconds).toISOString();

function blankWorkspace(seed) {
  const data = clone(seed);
  for (const field of ['offers', 'offer_states', 'watches', 'candidates', 'transitions', 'event_receipts']) data[field] = [];
  data.id_sequence = 1;
  return data;
}

function filterCriteria(data, ceiling = 3000) {
  const product = data.products.find(item => item.product_family_id === 'filter-family' && item.variant_revision === 'R1');
  if (!product) throw Error('The example requires the declared filter-family/R1 fixture.');
  const eligible = data.eligibility_sources.find(item => item.eligibility === 'eligible');
  if (!eligible) throw Error('The example requires an explicitly eligible seller source.');
  return {...clone(product), quantity: 1, allowed_seller_ids: [eligible.seller_id], currency: 'USD', ceiling_minor: ceiling};
}

function quoteEvent(data, criteria, {id = 'example-quote-event', episode = 'example-quote', at,
  validUntil = later(at, 60 * 60 * 1000), total = 2700, supersedes = []} = {}) {
  const source = data.eligibility_sources.find(item => item.seller_id === criteria.allowed_seller_ids[0] && item.eligibility === 'eligible');
  if (!source) throw Error('No trusted eligible source for the example seller.');
  return {event_id: id, at, operation: 'offer.quote_upsert', payload: {
    account_id: data.account_id, offer_episode_id: episode,
    product_family_id: criteria.product_family_id, variant_revision: criteria.variant_revision,
    pack_amount: criteria.pack_amount, pack_unit: criteria.pack_unit, quantity: criteria.quantity,
    seller_id: source.seller_id, currency: criteria.currency, item_total_minor: total,
    shipping_minor: 0, tax_minor: 0, eligible_discount_minor: 0,
    eligibility: source.eligibility, eligibility_source_id: source.eligibility_source_id,
    valid_from: at, valid_until: validUntil, source_id: 'synthetic-' + episode,
    product_url: 'https://merchant.example.invalid/products/' + criteria.product_family_id,
    supersedes: clone(supersedes)
  }};
}

module.exports = {clone, later, blankWorkspace, filterCriteria, quoteEvent};
