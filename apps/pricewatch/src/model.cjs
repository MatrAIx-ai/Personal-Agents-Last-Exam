'use strict';
const c=require('./common.cjs');
const collections=['products','sellers','eligibility_sources','offers','offer_states','watches','candidates','transitions','event_receipts'];
function validateSeed(ctx,data) {
  const bad=message=>c.fail('invalid_seed',message);
  c.scope(ctx,data,'invalid_seed');
  const now=c.instant(ctx.virtual_now);if(!Number.isFinite(now))bad('Missing trusted simulated time.');
  if(!Number.isSafeInteger(data.id_sequence)||data.id_sequence<1||collections.some(k=>!Array.isArray(data[k])))bad('Invalid business collections or ID sequence.');
  const unique=(items,key,label)=>{const seen=new Set();for(const item of items){const id=key(item);if(seen.has(id))bad('Duplicate '+label);seen.add(id);}};
  const time=(value,label)=>{const t=c.instant(value);if(!Number.isFinite(t)||t>now)bad('Invalid or unreleased '+label);return t;};
  unique(data.products,c.productKey,'catalog identity');unique(data.sellers,s=>s.seller_id,'seller');
  unique(data.eligibility_sources,s=>s.eligibility_source_id,'eligibility source');unique(data.offers,o=>o.offer_episode_id,'offer episode');
  unique(data.offer_states,s=>s.offer_episode_id,'quote state');unique(data.watches,w=>w.id,'watch ID');unique(data.watches,w=>w.watch_key,'watch key');
  unique(data.candidates,x=>x.id,'candidate ID');unique(data.transitions,x=>x.id,'transition ID');unique(data.event_receipts,x=>x.event_id,'event receipt');
  unique(objects(data),id=>id,'business object ID across collections');
  unique(data.candidates,x=>c.canonical([x.watch_id,x.watch_revision,x.activation_id,x.offer_episode_id]),'candidate logical identity');
  for(const p of data.products)if(!['ml','g','unit'].includes(p.pack_unit)||!Number.isFinite(p.pack_amount)||p.pack_amount<=0)bad('Invalid catalog pack.');
  for(const e of data.eligibility_sources)if(!data.sellers.some(s=>s.seller_id===e.seller_id))bad('Eligibility source seller is missing.');
  if(data.offers.length!==data.offer_states.length)bad('Every quote needs exactly one lifecycle record.');
  for(const q of data.offers){
    c.checkOffer(data,q,'invalid_seed');
    const s=c.offerState(data,q.offer_episode_id);if(!s)bad('Missing quote lifecycle.');
    const published=time(s.published_at,'quote publication'),changed=time(s.changed_at,'quote lifecycle');
    if(published<c.instant(q.valid_from)||published>=c.instant(q.valid_until)||changed<published)bad('Quote was published outside its validity.');
    if(s.state==='active'&&(s.reason!==null||s.superseded_by!==null))bad('Active quote has terminal metadata.');
    if(s.state==='revoked'&&(s.reason!=='seller_revoked'||s.superseded_by!==null))bad('Invalid revocation metadata.');
    if(s.state==='superseded'){
      const replacement=data.offers.find(x=>x.offer_episode_id===s.superseded_by);
      if(s.reason!=='quote_superseded'||!replacement||!replacement.supersedes.includes(q.offer_episode_id)||c.targetKey(replacement)!==c.targetKey(q))bad('Invalid quote supersession.');
    }
    for(const priorId of q.supersedes){const prior=data.offers.find(x=>x.offer_episode_id===priorId),ps=c.offerState(data,priorId);
      if(!prior||!ps||ps.superseded_by!==q.offer_episode_id||c.targetKey(prior)!==c.targetKey(q)||c.instant(ps.published_at)>published)bad('Dangling or inconsistent supersession.');}
  }
  for(const w of data.watches){
    if(w.account_id!==data.account_id)bad('Foreign watch account.');
    c.checkCriteria(data,w.criteria,'invalid_seed');if(!c.same(w.criteria,c.normalizeCriteria(w.criteria)))bad('Stored criteria must be canonical.');
    const created=time(w.created_at,'watch creation'),updated=time(w.updated_at,'watch update');if(updated<created)bad('Reversed watch timestamps.');
    if(!Number.isSafeInteger(w.watch_revision)||w.watch_revision<1||!Number.isSafeInteger(w.activation_count)||w.activation_count<0)bad('Invalid business revision/activation.');
    const activation=w.activation_count?w.id+':activation:'+w.activation_count:null;
    if(w.activation_id!==activation||(w.state==='active'&&!activation))bad('Watch activation identity mismatch.');
    const own=data.transitions.filter(t=>t.watch_id===w.id&&['watch_created','criteria_changed','paused','resumed'].includes(t.kind));
    if(!own.length||own[0].kind!=='watch_created'||time(own[0].at,'watch origin')!==created||own.filter(t=>t.kind==='watch_created').length!==1)bad('Missing coherent watch origin.');
    let revisionNumber=1,activationNumber=own[0].state==='active'?1:0,priorState=own[0].state,priorCriteria=own[0].criteria,pendingEcho=null;
    for(let i=0;i<own.length;i++){
      const t=own[i];
      if(i===0){if(t.watch_revision!==1||!t.criteria)bad('Watch origin must establish criteria revision one.');}
      else if(t.kind==='criteria_changed'){
        if(pendingEcho||!t.criteria||c.same(t.criteria,priorCriteria))bad('Invalid material-change history.');
        revisionNumber++;
        if(t.state==='active')activationNumber++;
        if(t.state!==priorState)pendingEcho={kind:t.state==='active'?'resumed':'paused',at:t.at};
        priorCriteria=t.criteria;
      }else if(t.kind==='paused'||t.kind==='resumed'){
        const expectedState=t.kind==='resumed'?'active':'paused';
        if(t.criteria!==null||t.state!==expectedState)bad('Invalid state-only watch transition.');
        if(pendingEcho){
          if(t.kind!==pendingEcho.kind||c.instant(t.at)!==c.instant(pendingEcho.at))bad('Combined rule/state change history is incomplete.');
          pendingEcho=null;
        }else{
          if(t.state===priorState)bad('Repeated state-only transition is not a state change.');
          if(t.state==='active')activationNumber++;
        }
      }
      const expectedActivation=activationNumber?w.id+':activation:'+activationNumber:null;
      if(t.watch_revision!==revisionNumber||t.activation_id!==expectedActivation)bad('Watch history skips or reuses a criteria revision/activation.');
      priorState=t.state;
    }
    if(pendingEcho||activationNumber!==w.activation_count)bad('Watch activation history is incomplete.');
    const revisions=own.filter(t=>t.kind==='watch_created'||t.kind==='criteria_changed');
    for(let i=0;i<revisions.length;i++){if(revisions[i].watch_revision!==i+1||!revisions[i].criteria)bad('Non-contiguous criteria revision history.');c.checkCriteria(data,revisions[i].criteria,'invalid_seed');}
    const last=own[own.length-1],revision=revisions[revisions.length-1];
    if(revision.watch_revision!==w.watch_revision||!c.same(revision.criteria,w.criteria)||last.state!==w.state||last.activation_id!==w.activation_id||time(last.at,'last watch mutation')!==updated)bad('Watch disagrees with its retained history.');
  }
  for(const candidate of data.candidates){
    const w=data.watches.find(w=>w.id===candidate.watch_id),q=data.offers.find(q=>q.offer_episode_id===candidate.offer_episode_id);
    if(candidate.account_id!==data.account_id||!w||!q)bad('Foreign or dangling candidate.');
    const created=time(candidate.created_at,'candidate creation'),statusAt=time(candidate.status_at,'candidate state');
    if(created<c.instant(w.created_at)||statusAt<created||created<c.instant(q.valid_from)||created>=c.instant(q.valid_until)||created<c.instant(c.offerState(data,q.offer_episode_id).published_at))bad('Impossible candidate timeline.');
    if(candidate.total_minor!==c.payable(q)||candidate.total_minor===null||candidate.currency!==q.currency||c.instant(candidate.valid_until)!==c.instant(q.valid_until))bad('Candidate price does not match its immutable quote.');
    const activationPrefix=w.id+':activation:',n=typeof candidate.activation_id==='string'&&candidate.activation_id.startsWith(activationPrefix)?Number(candidate.activation_id.slice(activationPrefix.length)):NaN;
    if(!Number.isSafeInteger(n)||n<1||n>w.activation_count||candidate.watch_revision<1||candidate.watch_revision>w.watch_revision)bad('Candidate refers to an unknown revision/activation.');
    const revision=data.transitions.find(t=>t.watch_id===w.id&&t.watch_revision===candidate.watch_revision&&t.criteria);
    if(!revision)bad('Candidate criteria provenance is missing.');
    if(created<c.instant(revision.at))bad('Candidate predates the criteria revision it relies on.');
    if(!c.same(c.productKey(revision.criteria),c.productKey(q))||revision.criteria.quantity!==q.quantity||revision.criteria.currency!==q.currency||!revision.criteria.allowed_seller_ids.includes(q.seller_id)||candidate.total_minor>revision.criteria.ceiling_minor||q.eligibility!=='eligible')bad('Candidate does not satisfy the rule revision which generated it.');
    const history=data.transitions.filter(t=>t.candidate_id===candidate.id);
    if(!history.length||history[0].kind!=='candidate_available'||time(history[0].at,'candidate origin')!==created||history.length>2)bad('Invalid candidate transition history.');
    // Check the policy/activation which actually existed before this origin,
    // not merely a matching revision found somewhere in the final snapshot.
    const originIndex=data.transitions.indexOf(history[0]);
    const activeHistory=data.transitions.slice(0,originIndex).filter(t=>t.watch_id===w.id&&['watch_created','criteria_changed','paused','resumed'].includes(t.kind));
    const activeAtOrigin=activeHistory[activeHistory.length-1];
    if(!activeAtOrigin||activeAtOrigin.state!=='active'||activeAtOrigin.watch_revision!==candidate.watch_revision||activeAtOrigin.activation_id!==candidate.activation_id||created<c.instant(activeAtOrigin.at))bad('Candidate originated before its rule/activation was active.');
    const marketState=c.offerState(data,q.offer_episode_id);
    if(marketState.state!=='active'&&created>c.instant(marketState.changed_at))bad('Candidate was created after its source quote was withdrawn.');
    if(candidate.source_event_id!==marketState.event_id)bad('Candidate source-event provenance disagrees with the quote publication.');
    const last=history[history.length-1],expected=candidate.status==='available_in_app'?'candidate_available':candidate.status==='expired'?'candidate_expired':'candidate_withdrawn';
    if(last.kind!==expected||time(last.at,'candidate terminal transition')!==statusAt||last.reason!==candidate.reason)bad('Candidate state disagrees with history.');
    if(candidate.status==='available_in_app'&&(history.length!==1||candidate.reason!==null||w.state!=='active'||w.watch_revision!==candidate.watch_revision||w.activation_id!==candidate.activation_id||c.offerState(data,q.offer_episode_id).state!=='active'))bad('An available candidate has an invalid current rule/source.');
    if(candidate.status==='expired'&&(candidate.reason!=='expired'||statusAt<c.instant(candidate.valid_until)))bad('Premature candidate expiry.');
    if(candidate.status==='withdrawn'&&(!candidate.reason||candidate.reason==='expired'))bad('Withdrawal reason missing.');
  }
  const previousByWatch=new Map();
  for(const t of data.transitions){
    const w=data.watches.find(w=>w.id===t.watch_id);if(!w)bad('Dangling watch transition.');
    const at=time(t.at,'transition');if(at<c.instant(w.created_at)||at<(previousByWatch.get(w.id)||-Infinity))bad('Unordered transition history.');previousByWatch.set(w.id,at);
    if(t.candidate_id){const x=data.candidates.find(x=>x.id===t.candidate_id);if(!x||x.watch_id!==w.id||x.watch_revision!==t.watch_revision||x.activation_id!==t.activation_id)bad('Transition/candidate linkage mismatch.');}
    else if(t.kind.startsWith('candidate_'))bad('Candidate transition needs its candidate.');
  }
  let previous=-Infinity;
  for(const e of data.event_receipts){
    const at=time(e.at,'event receipt');if(at<previous)bad('Event receipt time moved backwards.');previous=at;
    let event;try{event=JSON.parse(e.fingerprint);}catch{bad('Event receipt fingerprint is not JSON.');}
    if(!event||c.canonical(event)!==e.fingerprint||event.event_id!==e.event_id||event.at!==e.at||!c.same(Object.keys(event).sort(),['at','event_id','operation','payload'])||!event.payload||event.payload.account_id!==data.account_id)bad('Event receipt identity, time or account is inconsistent.');
    if(event.operation==='offer.quote_upsert'){
      const quote=data.offers.find(q=>q.offer_episode_id===event.payload.offer_episode_id);
      if(!Array.isArray(event.payload.supersedes))bad('Quote receipt has invalid supersession data.');
      const normalized={...event.payload,supersedes:[...new Set(event.payload.supersedes)].sort()};
      if(!quote||!c.same(quote,normalized))bad('Event receipt does not identify its immutable quote.');
    }else if(event.operation==='offer.revoke'){
      if(!c.same(Object.keys(event.payload).sort(),['account_id','offer_episode_id','reason'])||event.payload.reason!=='seller_revoked'||!data.offers.some(q=>q.offer_episode_id===event.payload.offer_episode_id))bad('Invalid historical revocation event.');
    }else if(event.operation==='offer.expire_due'){
      if(!c.same(Object.keys(event.payload),['account_id']))bad('Invalid expiry event payload.');
    }else bad('Unknown historical event operation.');
  }
}
function records(data){return collections.flatMap(k=>data[k]);}
function objects(data){return [...data.watches,...data.candidates,...data.transitions].map(x=>x.id).concat(data.offers.map(x=>'offer:'+x.offer_episode_id),data.products.map(x=>'product:'+c.productKey(x)),data.sellers.map(x=>'seller:'+x.seller_id),data.eligibility_sources.map(x=>'eligibility:'+x.eligibility_source_id));}
module.exports={validateSeed,records,objects,references:()=>[]};
