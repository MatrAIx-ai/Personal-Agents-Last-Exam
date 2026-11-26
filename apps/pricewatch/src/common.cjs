'use strict';

const copy = value => structuredClone(value);
function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const same = (a,b) => canonical(a) === canonical(b);
function scope(ctx, data, code='permission_denied') {
  const bound = ctx.binding?.accounts?.some(a => a.app_id === 'pricewatch' && a.account_id === data.account_id);
  if (!bound) fail(code, 'The business account does not match the trusted binding.');
}
function normalizeCriteria(value) {
  return {...copy(value), pack_unit:value.pack_unit.trim().toLowerCase(), allowed_seller_ids:[...new Set(value.allowed_seller_ids)].sort()};
}
const productKey = item => canonical([item.product_family_id,item.variant_revision,item.pack_amount,item.pack_unit]);
const targetKey = item => canonical([item.product_family_id,item.variant_revision,item.pack_amount,item.pack_unit,item.quantity,item.seller_id,item.currency]);
function checkCriteria(data, criteria, code='invalid_arguments') {
  if (!data.products.some(p => productKey(p) === productKey(criteria))) fail(code,'Unknown exact product, variant or pack.');
  if (!criteria.allowed_seller_ids.length || criteria.allowed_seller_ids.some(id => !data.sellers.some(s => s.seller_id === id))) fail(code,'Unknown or empty seller selection.');
  if (!Number.isSafeInteger(criteria.ceiling_minor) || criteria.ceiling_minor < 0 || !Number.isSafeInteger(criteria.quantity) || criteria.quantity < 1) fail(code,'Invalid quantity or price ceiling.');
}
const MONEY = ['item_total_minor','shipping_minor','tax_minor','eligible_discount_minor'];
function payable(offer) {
  if (MONEY.some(k => offer[k] === null || offer[k] === undefined)) return null;
  if (MONEY.some(k=>!Number.isSafeInteger(offer[k])||offer[k]<0))return null;
  // Intermediate addition may exceed Number's precision even if a discount
  // brings the final amount back into the supported safe-integer range.
  const total = BigInt(offer.item_total_minor)+BigInt(offer.shipping_minor)+BigInt(offer.tax_minor)-BigInt(offer.eligible_discount_minor);
  return total>=0n&&total<=BigInt(Number.MAX_SAFE_INTEGER)?Number(total):null;
}
function checkOffer(data, offer, code='invalid_event') {
  if (offer.account_id !== data.account_id) fail(code,'Quote account mismatch.');
  if (!data.products.some(p => p.product_family_id === offer.product_family_id) || !data.sellers.some(s => s.seller_id === offer.seller_id)) fail(code,'Unknown product family or seller.');
  if (['variant_revision','pack_amount','pack_unit'].every(k => offer[k] !== null) && !data.products.some(p => productKey(p) === productKey(offer))) fail(code,'Unknown exact quote identity.');
  const source = data.eligibility_sources.find(s => s.eligibility_source_id === offer.eligibility_source_id);
  if (!source || source.seller_id !== offer.seller_id || source.eligibility !== offer.eligibility) fail(code,'Quote eligibility lacks matching trusted account evidence.');
  if (!Number.isFinite(instant(offer.valid_from)) || !Number.isFinite(instant(offer.valid_until)) || instant(offer.valid_from) >= instant(offer.valid_until)) fail(code,'Invalid quote validity interval.');
  if (MONEY.some(k => offer[k] !== null && (!Number.isSafeInteger(offer[k]) || offer[k] < 0))) fail(code,'Money is an integer minor-unit amount or explicitly unknown.');
  if (MONEY.every(k => offer[k] !== null) && payable(offer) === null) fail(code,'Invalid or overflowing checkout total.');
  if (!same(offer.supersedes,[...new Set(offer.supersedes)].sort()) || offer.supersedes.includes(offer.offer_episode_id)) fail(code,'Invalid supersession references.');
}
function offerState(data, id) { return data.offer_states.find(s => s.offer_episode_id === id); }
function offerStatus(data, offer, now) {
  const state = offerState(data,offer.offer_episode_id);
  if (!state) fail('invalid_state','Quote state is missing.');
  if (state.state !== 'active') return state.state;
  return instant(now) >= instant(offer.valid_until) ? 'expired' : 'available';
}
function missing(offer) {
  const keys = ['variant_revision','pack_amount','pack_unit','quantity','currency',...MONEY];
  const fields = keys.filter(k => offer[k] === null || offer[k] === undefined);
  if (offer.eligibility === 'unknown') fields.push('eligibility');
  return fields;
}
function matches(data, watch, offer, now) {
  const c = watch.criteria, state = offerState(data,offer.offer_episode_id);
  if (watch.state !== 'active' || !state || instant(state.published_at) > instant(now) || instant(offer.valid_from) > instant(now) || offerStatus(data,offer,now) !== 'available') return false;
  return !missing(offer).length && offer.eligibility === 'eligible' && productKey(c) === productKey(offer) &&
    c.quantity === offer.quantity && c.currency === offer.currency && c.allowed_seller_ids.includes(offer.seller_id) && payable(offer) <= c.ceiling_minor;
}
function effectiveCandidate(data, candidate, now) {
  if (candidate.status !== 'available_in_app') return candidate.status;
  if (instant(now) >= instant(candidate.valid_until)) return 'expired';
  const watch = data.watches.find(w => w.id === candidate.watch_id), quote = data.offers.find(o => o.offer_episode_id === candidate.offer_episode_id);
  return watch && quote && watch.watch_revision === candidate.watch_revision && watch.activation_id === candidate.activation_id && matches(data,watch,quote,now) ? 'available_in_app' : 'withdrawn';
}
const candidateView = (data,c,now) => ({...copy(c),effective_status:effectiveCandidate(data,c,now)});
const watchView = (data,w,now) => ({...copy(w),available_candidate_count:data.candidates.filter(c=>c.watch_id===w.id && effectiveCandidate(data,c,now)==='available_in_app').length});
const offerView = (data,o,now) => ({...copy(o),stored_state:offerState(data,o.offer_episode_id).state,effective_status:offerStatus(data,o,now),total_minor:payable(o),missing_fields:missing(o)});
function nextId(data,kind) {
  let id;
  do {
    if(!Number.isSafeInteger(data.id_sequence)||data.id_sequence>=Number.MAX_SAFE_INTEGER)fail('capacity_exceeded','The deterministic ID sequence is exhausted.');
    id='pw-'+kind+'-'+data.id_sequence++;
  } while ([...data.watches,...data.candidates,...data.transitions].some(x=>x.id===id));
  return id;
}
function transition(ctx,data,watch,kind,{candidate=null,reason=null,criteria=null}={}) {
  data.transitions.push({id:nextId(data,'transition'),watch_id:watch.id,candidate_id:candidate?.id||null,at:ctx.virtual_now,kind,
    watch_revision:candidate?.watch_revision||watch.watch_revision,activation_id:candidate?.activation_id||watch.activation_id,
    state:watch.state,reason,criteria:criteria?copy(criteria):null});
}
function closeCandidate(ctx,data,c,status,reason) {
  if (c.status !== 'available_in_app') return;
  c.status=status;c.status_at=ctx.virtual_now;c.reason=reason;
  transition(ctx,data,data.watches.find(w=>w.id===c.watch_id),status==='expired'?'candidate_expired':'candidate_withdrawn',{candidate:c,reason});
}
function expire(ctx,data) {
  for (const c of data.candidates) if (c.status==='available_in_app' && instant(ctx.virtual_now)>=instant(c.valid_until)) closeCandidate(ctx,data,c,'expired','expired');
}
function evaluate(ctx,data,watch) {
  const created=[];
  for (const quote of data.offers) {
    if (!matches(data,watch,quote,ctx.virtual_now) || data.candidates.some(c=>c.watch_id===watch.id && c.watch_revision===watch.watch_revision && c.activation_id===watch.activation_id && c.offer_episode_id===quote.offer_episode_id)) continue;
    const candidate={id:nextId(data,'candidate'),account_id:data.account_id,watch_id:watch.id,watch_revision:watch.watch_revision,activation_id:watch.activation_id,
      offer_episode_id:quote.offer_episode_id,created_at:ctx.virtual_now,status:'available_in_app',status_at:ctx.virtual_now,reason:null,
      total_minor:payable(quote),currency:quote.currency,valid_until:quote.valid_until,source_event_id:offerState(data,quote.offer_episode_id).event_id};
    data.candidates.push(candidate);transition(ctx,data,watch,'candidate_available',{candidate});created.push(candidate.id);
  }
  return created;
}
function page(items,offset=0,limit=50) { return {items:items.slice(offset,offset+limit),next:offset+limit<items.length?offset+limit:null}; }
module.exports={copy,fail,canonical,same,instant,scope,normalizeCriteria,productKey,targetKey,checkCriteria,payable,checkOffer,offerState,offerStatus,matches,effectiveCandidate,candidateView,watchView,offerView,nextId,transition,closeCandidate,expire,evaluate,page};
