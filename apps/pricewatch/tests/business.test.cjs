'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture,unchanged} = require('./harness.cjs');
const {
  T0,T1,END,seed,criteria,quote,quoteEvent,revokeEvent,expiryEvent,
  upsert,get,available,marketAndRules
} = require('./fixtures.cjs');

const fresh = options => fixture({seed:seed(),now:T0,...options});
const watch = (f,id) => get(f,id).watch;

test('seed event receipts cannot conceal another account or a changed event identity',()=>{
  const f=fresh();
  for(const mutation of ['foreign-account','different-id','malformed-json']){
    const forged=f.data;
    const event={at:T0,event_id:mutation==='different-id'?'another-id':'seed-event',operation:'offer.expire_due',payload:{account_id:mutation==='foreign-account'?'account-b':forged.account_id}};
    forged.event_receipts.push({event_id:'seed-event',at:T0,fingerprint:mutation==='malformed-json'?'not JSON':JSON.stringify(event)});
    assert.throws(()=>f.validate(forged),/event|receipt|fingerprint|account/i,mutation);
  }
});

test('checkout arithmetic stays exact when a discount offsets a large subtotal',()=>{
  const f=fresh();
  f.event(quoteEvent('large-total',quote('large-total',{
    item_total_minor:Number.MAX_SAFE_INTEGER,shipping_minor:2,
    tax_minor:0,eligible_discount_minor:2
  })));
  // The exact final total is safe, even though subtotal addition exceeds the
  // Number exact-integer range before the discount is subtracted.
  const offer=f.call('pricewatch.offers.list',{}).items[0];
  assert.equal(offer.total_minor,Number.MAX_SAFE_INTEGER);
  const below=upsert(f,'large-total',criteria({ceiling_minor:Number.MAX_SAFE_INTEGER-1}));
  assert.equal(available(get(f,below.watch_id)).length,0);
  const equal=upsert(f,'large-total',criteria({ceiling_minor:Number.MAX_SAFE_INTEGER}));
  assert.equal(available(get(f,equal.watch_id)).length,1);
});

test('seed candidate provenance must have existed when the candidate was created',()=>{
  const f=fresh();
  f.event(quoteEvent('event-a'));
  upsert(f,'intent',criteria({ceiling_minor:2000}));
  f.advanceTime(T1);
  upsert(f,'intent',criteria({ceiling_minor:3000}));
  const forged=f.data,candidate=forged.candidates[0];
  // Retain a matching rev2 snapshot, but move its candidate before rev2 existed.
  // The array remains chronological, so ordering alone cannot detect this.
  candidate.created_at=T0;candidate.status_at=T0;
  const origin=forged.transitions.find(t=>t.candidate_id===candidate.id);
  origin.at=T0;
  forged.transitions=forged.transitions.filter(t=>t!==origin);
  forged.transitions.splice(1,0,origin);
  assert.throws(()=>f.validate(forged),/candidate|revision|activation|history|provenance/i);
});

test('seed cannot claim a candidate was created after its source was revoked',()=>{
  const f=fresh();
  f.event(quoteEvent('event-a'));upsert(f);
  f.event(revokeEvent('revoke-a','offer-a',T1));
  f.advanceTime('2026-12-02T09:30:00-08:00');
  const forged=f.data,candidate=forged.candidates[0];
  candidate.created_at='2026-12-02T09:10:00-08:00';
  candidate.status_at='2026-12-02T09:20:00-08:00';
  forged.transitions.find(t=>t.kind==='candidate_available').at=candidate.created_at;
  forged.transitions.find(t=>t.kind==='candidate_withdrawn').at=candidate.status_at;
  assert.throws(()=>f.validate(forged),/candidate|source|quote|revok|history|timeline/i);
});

test('seed object identities cannot collide across watch and candidate collections',()=>{
  const f=fresh();
  f.event(quoteEvent('event-a'));upsert(f);
  const forged=f.data,old=forged.candidates[0].id;
  forged.candidates[0].id=forged.watches[0].id;
  for(const transition of forged.transitions)
    if(transition.candidate_id===old)transition.candidate_id=forged.candidates[0].id;
  assert.throws(()=>f.validate(forged),/duplicate|identity|collision|object/i);
});

test('seed watch origins and later activations follow the public transition sequence',()=>{
  const make=kind=>{
    const f=fresh();
    upsert(f,'sequence',criteria(),kind==='created-paused'?'paused':'active');
    if(kind==='resume') {
      upsert(f,'sequence',criteria(),'paused');
      f.advanceTime(T1);upsert(f,'sequence',criteria(),'active');
    } else if(kind==='material') {
      f.advanceTime(T1);upsert(f,'sequence',criteria({ceiling_minor:2800}));
    }
    return f;
  };
  const changeLastActivation=(data,count)=>{
    const w=data.watches[0],last=data.transitions[data.transitions.length-1];
    w.activation_count=count;
    w.activation_id=count?w.id+':activation:'+count:null;
    last.activation_id=w.activation_id;
  };
  const cases=[
    ['active origin cannot begin at2','created-active',d=>changeLastActivation(d,2)],
    ['paused origin has not activated','created-paused',d=>changeLastActivation(d,1)],
    ['resume cannot skip an activation','resume',d=>changeLastActivation(d,3)],
    ['resume cannot reuse an activation','resume',d=>changeLastActivation(d,1)],
    ['material edit cannot skip an activation','material',d=>changeLastActivation(d,3)],
    ['material edit cannot reuse an activation','material',d=>changeLastActivation(d,1)],
    ['criteria revisions are contiguous','material',d=>{
      d.watches[0].watch_revision=3;
      d.transitions[d.transitions.length-1].watch_revision=3;
    }]
  ];
  for(const [label,kind,mutate] of cases) {
    const f=make(kind),forged=f.data;mutate(forged);
    assert.throws(()=>f.validate(forged),/watch|origin|activation|revision|history|transition/i,label);
  }
});

function withMatch() {
  const f=fresh();
  f.event(quoteEvent('event-a'));
  const created=upsert(f);
  assert.equal(available(get(f,created.watch_id)).length,1);
  return {f,id:created.watch_id,created};
}

test('reads expose the released market and never mutate business data',()=>{
  const f=fresh();f.event(quoteEvent('event-a'));
  const before=f.data;
  const list=f.call('pricewatch.offers.list',{});
  assert.equal(list.items.length,1);
  assert.equal(list.items[0].total_minor,2700);
  assert.equal(list.items[0].effective_status,'available');
  assert.equal(f.call('pricewatch.watch.list',{}).items.length,0);
  assert.deepEqual(f.data,before);
  unchanged(f,()=>f.call('pricewatch.watch.get',{watch_id:'missing'}),/not|exist|found/i);
});

test('an active watch evaluates a quote that existed before it',()=>{
  const {f,id,created}=withMatch();
  assert.equal(created.created,true);assert.equal(created.changed,true);
  assert.equal(created.watch_revision,1);
  const state=get(f,id),candidate=available(state)[0];
  assert.equal(state.watch.watch_key,'refill-intent');
  assert.equal(state.watch.available_candidate_count,1);
  assert.equal(candidate.offer_episode_id,'offer-a');
  assert.equal(candidate.total_minor,2700);assert.equal(candidate.currency,'USD');
  assert.equal(candidate.watch_revision,1);
  assert.equal(candidate.activation_id,state.watch.activation_id);
});

test('same intent key remains one server identity across ceiling and variant changes',()=>{
  const {f,id}=withMatch();
  f.event(quoteEvent('event-f2',quote('offer-f2',{variant_revision:'F2',item_total_minor:1800,tax_minor:144})));
  const initial=watch(f,id),old=available(get(f,id))[0];
  const changed=upsert(f,'refill-intent',criteria({ceiling_minor:2800}));
  assert.equal(changed.watch_id,id);assert.equal(changed.created,false);
  assert.equal(changed.watch_revision,2);
  assert.notEqual(changed.activation_id,initial.activation_id);
  let state=get(f,id);
  assert.equal(state.candidates.find(c=>c.id===old.id).status,'withdrawn');
  assert.equal(available(state).length,1);
  assert.notEqual(available(state)[0].id,old.id);
  const variant=upsert(f,'refill-intent',criteria({variant_revision:'F2',ceiling_minor:2800}));
  assert.equal(variant.watch_id,id);assert.equal(variant.watch_revision,3);
  state=get(f,id);assert.equal(available(state).length,1);
  assert.equal(available(state)[0].offer_episode_id,'offer-f2');
  assert.equal(f.call('pricewatch.watch.list',{}).items.length,1);
  assert.equal(state.transitions.filter(t=>t.kind==='criteria_changed').length,2);
});

test('different caller intent keys are not silently merged by matching criteria',()=>{
  const f=fresh();const a=upsert(f,'household-a'),b=upsert(f,'household-b');
  assert.notEqual(a.watch_id,b.watch_id);
  assert.equal(f.call('pricewatch.watch.list',{}).items.length,2);
});

test('seller-set order, duplicates and pack-unit spelling normalize to a business no-op',()=>{
  const f=fresh();const first=upsert(f,'stable',criteria({allowed_seller_ids:['seller-b','seller-a']}));
  const before=f.data;
  const same=upsert(f,'stable',criteria({allowed_seller_ids:['seller-a','seller-b','seller-a'],pack_unit:' mL '}));
  assert.equal(same.created,false);assert.equal(same.changed,false);
  assert.equal(same.watch_id,first.watch_id);
  assert.equal(same.watch_revision,first.watch_revision);
  assert.equal(same.activation_id,first.activation_id);
  assert.deepEqual(f.data,before);
  assert.deepEqual(watch(f,first.watch_id).criteria.allowed_seller_ids,['seller-a','seller-b']);
});

test('every criteria field is material, even if no offer currently matches',()=>{
  const cases=[
    criteria({product_family_id:'filter-family',variant_revision:'R1',pack_amount:1,pack_unit:'unit'}),
    criteria({variant_revision:'F2'}),criteria({pack_amount:15}),criteria({quantity:2}),
    criteria({allowed_seller_ids:['seller-b']}),criteria({currency:'CAD'}),criteria({ceiling_minor:2999})
  ];
  for(const rule of cases){
    const f=fresh(),a=upsert(f,'stable'),b=upsert(f,'stable',rule);
    assert.equal(b.watch_id,a.watch_id);assert.equal(b.watch_revision,2);
    assert.notEqual(b.activation_id,a.activation_id);
    assert.equal(watch(f,a.watch_id).state,'active');
  }
});

test('pause withdraws atomically; paused edit does not activate; resume re-evaluates current offers',()=>{
  const {f,id}=withMatch();
  const before=watch(f,id),old=available(get(f,id))[0];
  const paused=upsert(f,'refill-intent',criteria(),'paused');
  assert.equal(paused.watch_revision,1);assert.equal(paused.activation_id,before.activation_id);
  assert.equal(watch(f,id).available_candidate_count,0);
  assert.equal(get(f,id).candidates.find(c=>c.id===old.id).reason,'paused');
  f.event(quoteEvent('later',quote('offer-later',{item_total_minor:2000})));
  const edit=upsert(f,'refill-intent',criteria({ceiling_minor:2800}),'paused');
  assert.equal(edit.watch_id,id);assert.equal(edit.watch_revision,2);
  assert.equal(edit.activation_id,before.activation_id);
  assert.equal(available(get(f,id)).length,0);
  const resume=upsert(f,'refill-intent',criteria({ceiling_minor:2800}),'active');
  assert.equal(resume.watch_revision,2);assert.notEqual(resume.activation_id,before.activation_id);
  const state=get(f,id);assert.equal(available(state).length,2);
  assert.equal(state.candidates.find(c=>c.id===old.id).status,'withdrawn');
});

test('simultaneous criteria and state changes create only the appropriate activation',()=>{
  const {f,id}=withMatch();const before=watch(f,id);
  const pause=upsert(f,'refill-intent',criteria({ceiling_minor:2800}),'paused');
  assert.equal(pause.watch_revision,2);assert.equal(watch(f,id).activation_count,before.activation_count);
  const resume=upsert(f,'refill-intent',criteria({ceiling_minor:2900}),'active');
  assert.equal(resume.watch_revision,3);
  assert.equal(watch(f,id).activation_count,before.activation_count+1);
  assert.equal(available(get(f,id)).length,1);
});

test('price qualification uses inclusive all-in totals and known zero lines',()=>{
  for(const [cap,expected] of [[2700,1],[2699,0]]){
    const f=fresh();f.event(quoteEvent('price'));
    const w=upsert(f,'cap',criteria({ceiling_minor:cap}));
    assert.equal(available(get(f,w.watch_id)).length,expected);
  }
  const f=fresh();f.event(quoteEvent('shipping',quote('shipping',{item_total_minor:2400,shipping_minor:600,tax_minor:192})));
  const w=upsert(f);assert.equal(available(get(f,w.watch_id)).length,0);
  assert.equal(f.call('pricewatch.offers.list',{}).items[0].total_minor,3192);
});

test('a discount is subtracted once; already extended quote quantity is not multiplied again',()=>{
  const f=fresh();f.event(quoteEvent('discount',quote('discount',{quantity:2,item_total_minor:5000,tax_minor:400,eligible_discount_minor:1000})));
  const w=upsert(f,'two',criteria({quantity:2,ceiling_minor:4400}));
  assert.equal(available(get(f,w.watch_id))[0].total_minor,4400);
});

test('missing payable or identity fields remain visible unknowns and never qualify',()=>{
  for(const field of ['item_total_minor','shipping_minor','tax_minor','eligible_discount_minor','variant_revision','pack_amount','pack_unit','quantity','currency']){
    const f=fresh();f.event(quoteEvent('unknown',quote('unknown',{[field]:null})));
    const w=upsert(f);
    assert.equal(available(get(f,w.watch_id)).length,0,field);
    const offer=f.call('pricewatch.offers.list',{}).items[0];
    assert.ok(offer.missing_fields.includes(field),field+' reported missing');
  }
});

test('ineligible and unknown account terms are not caller-granted membership',()=>{
  for(const [source,eligibility] of [['terms-c','ineligible'],['terms-c-unknown','unknown']]){
    const f=fresh();f.event(quoteEvent('terms',quote('terms',{seller_id:'seller-c',eligibility_source_id:source,eligibility,item_total_minor:1000})));
    const w=upsert(f,'terms',criteria({allowed_seller_ids:['seller-c']}));
    assert.equal(available(get(f,w.watch_id)).length,0);
  }
  const f=fresh();
  unchanged(f,()=>f.event(quoteEvent('lie',quote('lie',{seller_id:'seller-c',eligibility_source_id:'terms-c',eligibility:'eligible'}))),/eligib|source|term/i);
  unchanged(f,()=>f.call('pricewatch.watch.upsert',{watch_key:'leak',criteria:criteria(),state:'active',medical_notes:'private diary'}),/Input schema/);
});

test('exact formula, pack, quantity, seller and currency cannot silently transfer',()=>{
  const variants=[
    {variant_revision:'F2'},{pack_amount:15},{quantity:2},
    {seller_id:'seller-b',eligibility_source_id:'terms-b'}, {currency:'CAD'}
  ];
  for(const patch of variants){
    const f=fresh();f.event(quoteEvent('other',quote('other',patch)));
    const w=upsert(f);assert.equal(available(get(f,w.watch_id)).length,0,JSON.stringify(patch));
  }
});

test('new transport event for identical immutable episode has no duplicate market or candidate effects',()=>{
  const {f,id}=withMatch();const before=marketAndRules(f.data);
  f.event(quoteEvent('new-transport',quote()));
  assert.deepEqual(marketAndRules(f.data),before);
  assert.equal(available(get(f,id)).length,1);
  unchanged(f,()=>f.event(quoteEvent('conflict',quote('offer-a',{item_total_minor:2000}))),/conflict|immutable|episode/i);
});

test('same event ID with different content is rejected without partial changes',()=>{
  const f=fresh();f.event(quoteEvent('event-a'));
  unchanged(f,()=>f.event(quoteEvent('event-a',quote('new-offer'))),/conflict|event|reuse/i);
});

test('supersession withdraws old quotes; replay and resume cannot resurrect them',()=>{
  const {f,id}=withMatch();
  f.event(quoteEvent('replace',quote('replacement',{item_total_minor:2000,supersedes:['offer-a']})));
  const state=get(f,id);
  assert.equal(state.candidates.find(c=>c.offer_episode_id==='offer-a').reason,'quote_superseded');
  assert.deepEqual(available(state).map(c=>c.offer_episode_id),['replacement']);
  const before=marketAndRules(f.data);
  f.event(quoteEvent('old-replay',quote()));
  assert.deepEqual(marketAndRules(f.data),before);
  upsert(f,'refill-intent',criteria(),'paused');upsert(f);
  assert.deepEqual(available(get(f,id)).map(c=>c.offer_episode_id),['replacement']);
  assert.equal(f.call('pricewatch.offers.list',{}).items.length,1);
  assert.equal(f.call('pricewatch.offers.list',{include_inactive:true}).items.length,2);
});

test('invalid supersession targets and unknown revocation are atomic rejections',()=>{
  const {f}=withMatch();
  unchanged(f,()=>f.event(quoteEvent('self',quote('self',{supersedes:['self']}))),/supersed|reference|self|exist/i);
  unchanged(f,()=>f.event(quoteEvent('missing',quote('replacement',{supersedes:['not-found']}))),/supersed|reference|exist|unknown/i);
  unchanged(f,()=>f.event(quoteEvent('cross-target',quote('replacement',{variant_revision:'F2',supersedes:['offer-a']}))),/supersed|target|match/i);
  unchanged(f,()=>f.event(revokeEvent('bad-revoke','not-found')),/exist|unknown|episode|reference/i);
});

test('revocation is retained across replay, paused market updates and resume',()=>{
  const {f,id}=withMatch();f.event(revokeEvent('revoke','offer-a'));
  assert.equal(available(get(f,id)).length,0);
  assert.equal(get(f,id).candidates[0].reason,'seller_revoked');
  const before=marketAndRules(f.data);f.event(revokeEvent('revoke-again','offer-a'));
  assert.deepEqual(marketAndRules(f.data),before);
  f.event(quoteEvent('replay-after-revoke',quote()));
  upsert(f,'refill-intent',criteria(),'paused');upsert(f);
  assert.equal(available(get(f,id)).length,0);
});

test('clock-only expiry is read-time effective, side-effect free and exact at the boundary',()=>{
  const {f,id}=withMatch();f.advanceTime('2026-12-02T17:59:59Z');
  assert.equal(available(get(f,id)).length,1);
  f.advanceTime('2026-12-02T18:00:00Z');
  const before=f.data,result=get(f,id);
  assert.equal(result.watch.available_candidate_count,0);
  assert.equal(result.candidates[0].status,'available_in_app');
  assert.equal(result.candidates[0].effective_status,'expired');
  assert.equal(f.call('pricewatch.watch.list',{}).items[0].available_candidate_count,0);
  assert.equal(f.call('pricewatch.offers.list',{}).items.length,0);
  assert.equal(f.call('pricewatch.offers.list',{include_inactive:true}).items[0].effective_status,'expired');
  assert.deepEqual(f.data,before);
});

test('explicit expiry records one transition, early calls and replay do not fabricate expiry',()=>{
  const {f,id}=withMatch();f.event(expiryEvent('early',T1));
  assert.equal(get(f,id).candidates[0].status,'available_in_app');
  f.event(expiryEvent('expire',END));
  const after=get(f,id);
  assert.equal(after.candidates[0].status,'expired');
  assert.equal(after.transitions.filter(t=>t.kind==='candidate_expired').length,1);
  f.event(expiryEvent('expire-again',END));
  assert.equal(get(f,id).transitions.filter(t=>t.kind==='candidate_expired').length,1);
  upsert(f,'refill-intent',criteria(),'paused');upsert(f);
  assert.equal(available(get(f,id)).length,0);
  assert.equal(get(f,id).candidates[0].status,'expired');
});

test('pause after clock-only expiry settles expiry instead of claiming withdrawal while valid',()=>{
  const {f,id}=withMatch();f.advanceTime(END);
  upsert(f,'refill-intent',criteria(),'paused');
  const state=get(f,id);
  assert.equal(state.candidates[0].status,'expired');
  assert.equal(state.candidates[0].reason,'expired');
  assert.equal(state.transitions.filter(t=>t.kind==='candidate_expired').length,1);
});

test('future-start publication and bad monetary totals are rejected atomically',()=>{
  const f=fresh();
  unchanged(f,()=>f.event(quoteEvent('future',quote('future',{valid_from:T1}))),/future|valid|publish|time/i);
  unchanged(f,()=>f.event(quoteEvent('negative',quote('negative',{eligible_discount_minor:99999}))),/total|negative|discount|price/i);
  unchanged(f,()=>f.event(quoteEvent('overflow',quote('overflow',{item_total_minor:Number.MAX_SAFE_INTEGER,tax_minor:1}))),/total|safe|overflow|price/i);
});

test('foreign accounts and malformed history cannot enter an account-local state',()=>{
  const f=fresh();
  unchanged(f,()=>f.event(quoteEvent('foreign',quote('foreign',{account_id:'account-b'}))),/account|scope|owner|binding/i);
  const bad=seed('account-b');assert.throws(()=>f.validate(bad),/account|scope|owner|binding/i);
  const {f:matched}=withMatch(),dupe=matched.data;
  dupe.candidates.push(structuredClone(dupe.candidates[0]));
  assert.throws(()=>matched.validate(dupe),/duplicate|unique|candidate/i);
});

test('paged list/get retain complete, non-duplicated inspectable history',()=>{
  const f=fresh();const a=upsert(f,'a'),b=upsert(f,'b'),c=upsert(f,'c');
  const first=f.call('pricewatch.watch.list',{limit:2});
  assert.equal(first.items.length,2);assert.notEqual(first.next_offset,null);
  const second=f.call('pricewatch.watch.list',{offset:first.next_offset,limit:2});
  assert.equal(second.items.length,1);assert.equal(second.next_offset,null);
  assert.deepEqual(new Set([...first.items,...second.items].map(w=>w.id)),new Set([a.watch_id,b.watch_id,c.watch_id]));
  upsert(f,'a',criteria(),'paused');upsert(f,'a');
  const ids=[];let offset=0;
  do{
    const page=get(f,a.watch_id,{history_offset:offset,limit:1});
    ids.push(...page.transitions.map(t=>t.id));offset=page.next_history_offset;
  }while(offset!==null);
  assert.equal(ids.length,get(f,a.watch_id).transitions.length);
  assert.equal(new Set(ids).size,ids.length);
});

test('optional absent or failing diagnostics never affect domain results',()=>{
  const a=fresh(),b=fresh({logging:false}),c=fresh();
  c.ctx.log=()=>{throw Error('diagnostics offline');};
  for(const f of [a,b,c]){f.event(quoteEvent('event-a'));upsert(f);}
  assert.deepEqual(a.data,b.data);assert.deepEqual(a.data,c.data);
});
