'use strict';
const c=require('./common.cjs');
function handleTool(ctx,input,name,args) {
  c.scope(ctx,input);
  const now=ctx.virtual_now;
  if (name==='pricewatch.offers.list') {
    const filtered=input.offers.filter(o=>(!args.product_family_id || o.product_family_id===args.product_family_id) &&
      c.instant(c.offerState(input,o.offer_episode_id).published_at)<=c.instant(now) && (args.include_inactive || c.offerStatus(input,o,now)==='available'));
    const p=c.page(filtered,args.offset,args.limit);return {data:input,result:{as_of:now,items:p.items.map(o=>c.offerView(input,o,now)),next_offset:p.next}};
  }
  if (name==='pricewatch.watch.list') {
    const p=c.page(input.watches,args.offset,args.limit);return {data:input,result:{as_of:now,items:p.items.map(w=>c.watchView(input,w,now)),next_offset:p.next}};
  }
  if (name==='pricewatch.watch.get') {
    const w=input.watches.find(w=>w.id===args.watch_id);if(!w)c.fail('not_found','Watch not found in this account.');
    const candidates=c.page(input.candidates.filter(x=>x.watch_id===w.id),args.candidate_offset,args.limit);
    const history=c.page(input.transitions.filter(x=>x.watch_id===w.id),args.history_offset,args.limit);
    return {data:input,result:{as_of:now,watch:c.watchView(input,w,now),candidates:candidates.items.map(x=>c.candidateView(input,x,now)),transitions:c.copy(history.items),next_candidate_offset:candidates.next,next_history_offset:history.next}};
  }
  if (name!=='pricewatch.watch.upsert') c.fail('unknown_tool','Unknown PriceWatch business operation.');
  const criteria=c.normalizeCriteria(args.criteria);c.checkCriteria(input,criteria);
  const data=c.copy(input);let watch=data.watches.find(w=>w.watch_key===args.watch_key);
  const created=!watch,material=!!watch&&!c.same(watch.criteria,criteria),stateChanged=!!watch&&watch.state!==args.state;
  if (watch&&!material&&!stateChanged) return {data,result:{watch_id:watch.id,watch_revision:watch.watch_revision,activation_id:watch.activation_id,state:watch.state,changed:false,created:false,candidate_ids:[]}};
  c.expire(ctx,data);
  if (!watch) {
    const id=c.nextId(data,'watch'),activation_count=args.state==='active'?1:0;
    watch={id,account_id:data.account_id,watch_key:args.watch_key,criteria,state:args.state,watch_revision:1,activation_count,
      activation_id:activation_count?id+':activation:'+activation_count:null,created_at:now,updated_at:now};
    data.watches.push(watch);c.transition(ctx,data,watch,'watch_created',{criteria});
  } else {
    for(const candidate of data.candidates.filter(x=>x.watch_id===watch.id))c.closeCandidate(ctx,data,candidate,'withdrawn',args.state==='paused'?'paused':'criteria_changed');
    watch.criteria=criteria;watch.updated_at=now;
    if(material)watch.watch_revision++;
    if(args.state==='active'&&(material||stateChanged)){watch.activation_count++;watch.activation_id=watch.id+':activation:'+watch.activation_count;}
    watch.state=args.state;
    if(material)c.transition(ctx,data,watch,'criteria_changed',{criteria});
    if(stateChanged)c.transition(ctx,data,watch,args.state==='paused'?'paused':'resumed');
  }
  const candidate_ids=c.evaluate(ctx,data,watch);
  return {data,result:{watch_id:watch.id,watch_revision:watch.watch_revision,activation_id:watch.activation_id,state:watch.state,changed:true,created,candidate_ids}};
}
module.exports={handleTool};
