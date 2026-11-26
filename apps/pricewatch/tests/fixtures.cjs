'use strict';
// Original controlled inputs for business tests. They contain no personal
// history or task answer flag; expected outcomes follow public technical rules.
const T0 = '2026-12-02T08:00:00-08:00';
const T1 = '2026-12-02T09:00:00-08:00';
const END = '2026-12-02T10:00:00-08:00';
function seed(account = 'account-a') {
  return {
    account_id: account, id_sequence: 1,
    products: [
      {product_family_id:'moist-family',variant_revision:'F1',pack_amount:50,pack_unit:'ml'},
      {product_family_id:'moist-family',variant_revision:'F2',pack_amount:50,pack_unit:'ml'},
      {product_family_id:'moist-family',variant_revision:'F1',pack_amount:15,pack_unit:'ml'},
      {product_family_id:'filter-family',variant_revision:'R1',pack_amount:1,pack_unit:'unit'},
      {product_family_id:'food-family',variant_revision:'D1',pack_amount:2000,pack_unit:'g'}
    ],
    sellers: ['seller-a','seller-b','seller-c'].map(seller_id => ({seller_id})),
    eligibility_sources: [
      {eligibility_source_id:'terms-a',seller_id:'seller-a',eligibility:'eligible'},
      {eligibility_source_id:'terms-b',seller_id:'seller-b',eligibility:'eligible'},
      {eligibility_source_id:'terms-c',seller_id:'seller-c',eligibility:'ineligible'},
      {eligibility_source_id:'terms-c-unknown',seller_id:'seller-c',eligibility:'unknown'}
    ],
    offers:[],offer_states:[],watches:[],candidates:[],transitions:[],event_receipts:[]
  };
}
function criteria(patch = {}) {
  return {
    product_family_id:'moist-family',variant_revision:'F1',pack_amount:50,pack_unit:'ml',
    quantity:1,allowed_seller_ids:['seller-a'],currency:'USD',ceiling_minor:3000,
    ...structuredClone(patch)
  };
}
function quote(id = 'offer-a', patch = {}) {
  return {
    account_id:'account-a',offer_episode_id:id,product_family_id:'moist-family',
    variant_revision:'F1',pack_amount:50,pack_unit:'ml',quantity:1,seller_id:'seller-a',
    currency:'USD',item_total_minor:2500,shipping_minor:0,tax_minor:200,
    eligible_discount_minor:0,eligibility:'eligible',eligibility_source_id:'terms-a',
    valid_from:T0,valid_until:END,source_id:'source-'+id,
    product_url:'https://seller-a.example.invalid/products/'+id,supersedes:[],
    ...structuredClone(patch)
  };
}
function quoteEvent(id, payload = quote(), at = T0) {
  return {event_id:id,at,operation:'offer.quote_upsert',payload:structuredClone(payload)};
}
function revokeEvent(id, episode, at = T0, account = 'account-a') {
  return {event_id:id,at,operation:'offer.revoke',payload:{account_id:account,offer_episode_id:episode,reason:'seller_revoked'}};
}
function expiryEvent(id, at, account = 'account-a') {
  return {event_id:id,at,operation:'offer.expire_due',payload:{account_id:account}};
}
function upsert(f, watch_key = 'refill-intent', rule = criteria(), state = 'active') {
  return f.call('pricewatch.watch.upsert',{watch_key,criteria:rule,state});
}
function get(f, id, args = {}) {
  return f.call('pricewatch.watch.get',{watch_id:id,limit:100,...args});
}
const available = result => result.candidates.filter(c => c.effective_status === 'available_in_app');
function marketAndRules(data) {
  const {event_receipts,...rest} = data;
  return rest;
}
module.exports = {T0,T1,END,seed,criteria,quote,quoteEvent,revokeEvent,expiryEvent,upsert,get,available,marketAndRules};
