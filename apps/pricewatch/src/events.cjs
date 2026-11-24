'use strict';
const c=require('./common.cjs');
function applyEvent(ctx,input,event) {
  if(ctx.role!=='infra')c.fail('permission_denied','Only Infra can inject market events.');
  c.scope(ctx,input,'invalid_event');
  if(!Number.isFinite(c.instant(event.at))||c.instant(event.at)!==c.instant(ctx.virtual_now))c.fail('invalid_event','Event time must equal the trusted processing time.');
  if(event.payload.account_id!==input.account_id)c.fail('invalid_event','Event account mismatch.');
  const fingerprint=c.canonical(event),prior=input.event_receipts.find(x=>x.event_id===event.event_id);
  if(prior){if(prior.fingerprint!==fingerprint)c.fail('idempotency_conflict','Conflicting event ID.');return c.copy(input);}
  const data=c.copy(input),payload=c.copy(event.payload);
  if(event.operation==='offer.quote_upsert') {
    payload.supersedes=[...new Set(payload.supersedes)].sort();c.checkOffer(data,payload);
    const existing=data.offers.find(o=>o.offer_episode_id===payload.offer_episode_id);
    if(existing) {
      if(!c.same(existing,payload))c.fail('idempotency_conflict','An offer episode is immutable; use a new episode ID.');
      // An old/revoked episode replay never rewrites lifecycle or makes new candidates.
    } else {
      if(c.instant(payload.valid_from)>c.instant(event.at)||c.instant(payload.valid_until)<=c.instant(event.at))c.fail('invalid_event','Publish a quote only during its validity, not before a future sale.');
      const previous=payload.supersedes.map(id=>{
        const quote=data.offers.find(o=>o.offer_episode_id===id),state=c.offerState(data,id);
        if(!quote||!state||state.state!=='active'||c.targetKey(quote)!==c.targetKey(payload))c.fail('invalid_event','Supersession requires an existing active quote for the same exact retail target.');
        return state;
      });
      c.expire(ctx,data);
      for(const state of previous){state.state='superseded';state.changed_at=event.at;state.reason='quote_superseded';state.superseded_by=payload.offer_episode_id;
        for(const candidate of data.candidates.filter(x=>x.offer_episode_id===state.offer_episode_id))c.closeCandidate(ctx,data,candidate,'withdrawn','quote_superseded');}
      data.offers.push(payload);data.offer_states.push({offer_episode_id:payload.offer_episode_id,state:'active',published_at:event.at,changed_at:event.at,event_id:event.event_id,reason:null,superseded_by:null});
      for(const watch of data.watches)c.evaluate(ctx,data,watch);
    }
  } else if(event.operation==='offer.revoke') {
    const state=c.offerState(data,payload.offer_episode_id);if(!state)c.fail('invalid_event','Unknown quote episode.');
    if(payload.reason!=='seller_revoked')c.fail('invalid_event','Unknown revocation reason.');
    c.expire(ctx,data);
    if(state.state==='active'){state.state='revoked';state.changed_at=event.at;state.reason='seller_revoked';
      for(const candidate of data.candidates.filter(x=>x.offer_episode_id===state.offer_episode_id))c.closeCandidate(ctx,data,candidate,'withdrawn','seller_revoked');}
  } else if(event.operation==='offer.expire_due')c.expire(ctx,data);
  else c.fail('invalid_event','Undeclared market operation.');
  data.event_receipts.push({event_id:event.event_id,at:event.at,fingerprint});
  return data;
}
module.exports={applyEvent};
