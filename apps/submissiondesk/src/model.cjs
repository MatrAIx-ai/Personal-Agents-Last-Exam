'use strict';
const {check,all,person,digest,bundleContent,snapshot,collections}=require('./domain.cjs');
function validateSeed(ctx,data){
 const valid=(x,m)=>check(x,'invalid_seed',m);
 valid(ctx.binding.people.some(p=>p.person_id===data.owner_person_id)&&ctx.binding.accounts.some(a=>a.app_id===ctx.app_id&&a.account_id===data.account_id&&a.owner_person_id===data.owner_person_id),'Account/owner must match a supplied binding');
 valid(Buffer.byteLength(JSON.stringify(data),'utf8')<=524288,'Business seed exceeds 512 KiB; this is separate from the decoded asset limit');
 const objects=all(data),ids=new Set(objects.map(x=>x.id));valid(ids.size===objects.length,'Object identifiers must be unique across collections');
 for(const x of objects)for(const key of ['created_at','updated_at','at'])if(x[key])valid(Date.parse(x[key])<=Date.parse(ctx.virtual_now),'Loaded records cannot be from the future');
 const maps=Object.fromEntries(collections.map(k=>[k,new Map(data[k].map(x=>[x.id,x]))]));
 const has=(k,id)=>maps[k].has(id),get=(k,id)=>maps[k].get(id);
 for(const r of data.records)valid(person(ctx,r.source_person_id),'Unknown context-record source');
 for(const v of data.venues)valid(Date.parse(v.abstract_before)<=Date.parse(v.submit_before)&&Date.parse(v.submit_before)<=Date.parse(v.withdraw_before),'Venue cutoff order');
 for(const p of data.papers)valid(p.author_person_ids.length&&new Set(p.author_person_ids).size===p.author_person_ids.length&&p.author_person_ids.every(x=>person(ctx,x)),'Unknown/duplicate paper author');
 for(const m of data.materials){
  valid(has('papers',m.paper_id)&&person(ctx,m.source_person_id),'Unknown material paper/source');
  valid(m.sections.length>0&&new Set(m.sections.map(x=>x.id)).size===m.sections.length,'Empty or duplicate sections');
  valid(Buffer.byteLength(JSON.stringify(m.sections),'utf8')<=65536,'One material body exceeds 64 KiB');
  if(m.parent_id!==null){const parent=get('materials',m.parent_id);valid(parent&&parent.paper_id===m.paper_id&&parent.id!==m.id,'Unknown/wrong-paper parent');valid(m.omitted_section_ids.every(x=>parent.sections.some(p=>p.id===x)),'Unknown omitted section');valid(JSON.stringify(m.sections)===JSON.stringify(parent.sections.filter(x=>!m.omitted_section_ids.includes(x.id))),'Derived content must preserve all unomitted sections');let p=parent,seen=new Set([m.id]);while(p){valid(!seen.has(p.id),'Cyclic material lineage');seen.add(p.id);p=p.parent_id===null?null:get('materials',p.parent_id);}}
  else valid(m.omitted_section_ids.length===0,'Root material cannot omit sections');
 }
 for(const b of data.bundles){valid(has('papers',b.paper_id)&&b.material_ids.length&&new Set(b.material_ids).size===b.material_ids.length&&b.material_ids.every(x=>has('materials',x)&&get('materials',x).paper_id===b.paper_id),'Unknown/duplicate/wrong-paper bundle material');valid(b.material_ids.every(x=>Date.parse(get('materials',x).created_at)<=Date.parse(b.created_at)),'Bundle predates its material');valid(b.author_person_ids.length&&new Set(b.author_person_ids).size===b.author_person_ids.length&&b.author_person_ids.every(x=>person(ctx,x)),'Unknown/duplicate bundle author');valid(b.content_digest===digest(bundleContent(data,b)),'Bundle digest disagrees with immutable content');}
 for(const q of data.requests){
  valid(person(ctx,q.recipient_person_id),'Unknown approval recipient');valid(q.scope==='purpose'?q.bundle_id===null:has('bundles',q.bundle_id),'Scope requires exact known bundle');
  if(q.reply!==null){valid(['answered','approved','changes_requested'].includes(q.status),'Terminal reply status');valid(q.reply.responder_person_id===q.recipient_person_id,'Reply source differs from recipient');valid(q.reply.content_digest===(q.bundle_id?get('bundles',q.bundle_id).content_digest:null),'Reply digest differs from requested bundle');valid((q.scope==='purpose')===(q.status==='answered'),'Purpose and bundle replies have different status sets');valid(Date.parse(q.reply.at)>=Date.parse(q.created_at)&&Date.parse(q.reply.at)<=Date.parse(ctx.virtual_now),'Reply predates request or comes from the future');}
  else valid(['pending','cancelled'].includes(q.status),'Resolved request requires a reply');
 }
 const activeAbstracts=new Set();for(const a of data.abstracts){valid(has('papers',a.paper_id)&&has('venues',a.venue_id),'Unknown abstract paper/venue');if(a.status==='registered'){const key=a.paper_id+':'+a.venue_id;valid(!activeAbstracts.has(key),'Duplicate active abstract');activeAbstracts.add(key);}}
 const submissions=new Set();for(const s of data.submissions){valid(has('papers',s.paper_id)&&has('venues',s.venue_id),'Unknown submission paper/venue');const key=s.paper_id+':'+s.venue_id;valid(!submissions.has(key),'Duplicate paper/venue submission');submissions.add(key);const last=get('receipts',s.last_receipt_id);valid(last&&last.submission_id===s.id,'Missing last submission receipt');if(s.status==='received')valid(s.active_receipt_id===last.id&&last.kind!=='withdrawn','Active snapshot mismatch');else valid(s.active_receipt_id===null&&last.kind==='withdrawn','Withdrawal snapshot mismatch');}
 for(const r of data.receipts){const s=get('submissions',r.submission_id),b=get('bundles',r.bundle_id);valid(s&&b&&b.paper_id===s.paper_id&&r.venue_id===s.venue_id,'Receipt has mismatched references');valid(digest(r.snapshot)===digest(snapshot(data,b)),'Receipt snapshot/content mismatch');if(r.previous_receipt_id!==null){const prev=get('receipts',r.previous_receipt_id);valid(prev&&prev.submission_id===s.id&&prev.kind!=='withdrawn'&&Date.parse(prev.at)<=Date.parse(r.at),'Invalid previous receipt');let next=prev,seen=new Set([r.id]);while(next){valid(!seen.has(next.id),'Cyclic receipt chain');seen.add(next.id);next=next.previous_receipt_id===null?null:get('receipts',next.previous_receipt_id);}}else valid(r.kind==='submitted','Only first receipt can lack predecessor');}
 for(const s of data.submissions){const seen=new Set();let r=get('receipts',s.last_receipt_id);while(r){valid(!seen.has(r.id),'Cyclic receipt chain');seen.add(r.id);valid((r.previous_receipt_id===null)===(r.kind==='submitted'),'Only the initial receipt is submitted');r=r.previous_receipt_id===null?null:get('receipts',r.previous_receipt_id);}valid(data.receipts.filter(x=>x.submission_id===s.id).length===seen.size,'Orphaned or branched submission receipt');}
 for(const [i,h]of data.history.entries())valid(h.sequence===i+1&&ids.has(h.object_id),'Invalid business-history correlation');
}
module.exports={validateSeed,objects:data=>all(data).map(x=>x.id),records:all,references:()=>[]};
