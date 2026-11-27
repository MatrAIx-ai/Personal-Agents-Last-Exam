'use strict';
const C=require('./common.cjs'),e=C.environment('submissiondesk',__dirname),{day,iso}=C;
const titles=['Transit survey replication','River gauge calibration','Search interface reproducibility','School energy audit','Archive annotation consistency','Sensor drift comparison','Public corpus deduplication','Accessibility field observations','Library retrieval error analysis','Municipal heat measurement','Bilingual label agreement','Year-end replication bulletin'];
const seeds=[];
for(let i=0;i<24;i++){
 const year=2025+Math.floor(i/12),month=i%12+1,key=year+'-'+String(month).padStart(2,'0'),start=Date.parse(key+(i===23?'-24':'-01')+'T09:00:00Z'),at=n=>iso(start+n*day);
 const data=C.fixture(e,['minimal.json','account-jun.json','account-ali.json'][i%3]);
 data.records=data.records.slice(0,3);for(const [j,r]of data.records.entries()){r.created_at=at(0);r.body=[`Publication brief for ${titles[i%12]} (${key}): final claims, author order and external release each require a positive reply bound to the exact frozen bundle.`,`The chosen outlet for this episode is ${i%2?'feedback workshop':'archival conference'}. A correction creates a new immutable bundle and needs fresh scoped clearance.`,`Synthetic drafting history: the initial result used ${42+i} samples. A later correction will document the excluded duplicates; no real research finding is represented.`][j];}
 data.papers=data.papers.filter(p=>p.id==='paper-alder');data.papers[0].title=titles[i%12]+' — '+year;
 data.materials=data.materials.filter(m=>m.id==='material-alder-1');data.materials[0].created_at=at(0);data.materials[0].sections=[{id:'intro',text:`Original synthetic ${key} study of ${titles[i%12].toLowerCase()}; this technical note documents methods and limits rather than a real scientific result.`},{id:'methods',text:`A preregistered-style mock comparison examined ${42+i} records across three strata. The public text omits personal identifiers and partner-only working tables.`},{id:'results',text:`Initial synthetic audit found ${3+i%7} duplicate observations. The denominator and version are stated so later corrections remain visible.`}];
 for(const v of data.venues){v.abstract_before=at(8);v.submit_before=at(9);v.withdraw_before=at(10);}
 for(const k of ['bundles','requests','abstracts','submissions','receipts','history'])data[k]=[];
 const h=C.runner(e,data,at(0)),venue=i%2?'venue-w':'venue-c',authors=data.papers[0].author_person_ids;
 h.advance(at(1));h.call('abstract.register',{paper_id:'paper-alder',venue_id:venue});
 function freeze(material){return h.call('bundle.create',{paper_id:'paper-alder',material_ids:[material],author_person_ids:authors}).item;}
 function clear(b,label){for(const [actor,scope]of [['person-reed','claims'],['person-jun','author-order'],['person-seema','external-release']]){const q=h.call('approval.request',{recipient_person_id:actor,scope,bundle_id:b.id}).item;h.event('approval.reply',{request_id:q.id,responder_person_id:actor,status:'approved',body:`${label}: I reviewed this exact ${scope} scope; this proof does not cover a different bundle.`,content_digest:b.content_digest});}}
 function commit(b){const preview=h.call('submission.preview',{bundle_id:b.id,venue_id:venue}).preview;return h.call('submission.commit',{bundle_id:b.id,venue_id:venue,preview});}
 const initial=freeze('material-alder-1');h.advance(at(2));clear(initial,'Initial review');h.advance(at(3));commit(initial);
 let kind='reviewed-release';
 if(i%4!==2){
  h.advance(at(4));h.event('material.add',{id:'material-corrected',paper_id:'paper-alder',source_person_id:'person-reed',sections:[...data.materials[0].sections.slice(0,2),{id:'results',text:`Corrected ${key} denominator excludes ${3+i%7} duplicates: ${42+i-(3+i%7)} unique records. This is a synthetic audit correction, not an observed result.`},{id:'partner-appendix',text:`Restricted working table for synthetic partner sample ${i+1}; this section is excluded from the public derivation.`}]});
  const publicMaterial=h.call('artifact.derive',{source_id:'material-corrected',omit_section_ids:['partner-appendix']}).item;
  const corrected=freeze(publicMaterial.id);h.advance(at(5));clear(corrected,'Correction review');h.advance(at(6));commit(corrected);kind='reviewed-correction';
 }
 h.advance(at(7));if(i%4===3){const s=h.data.submissions[0];h.call('submission.withdraw',{id:s.id});kind='corrected-then-withdrawn';}
 h.event('record.add',{id:'closeout',source_person_id:data.owner_person_id,body:`${key} closeout: ${kind}; the original receipt and any replacement or withdrawal remain separately inspectable. Reuse only the proof matching the selected received digest.`});
 seeds.push(C.seed(e,key,h.data,kind,`${titles[i%12]}: exact-content review and immutable portal history.`));
}
const r=C.deliver(e,seeds,'24 original synthetic research-release episodes over all 24 months, rotating three supplied research accounts. Monthly notes, actual App-produced bundle freezes, scoped proofs and receipt chains are delivered; these are independent workspace partitions, not live OpenReview exports.');
console.log(JSON.stringify({app:e.id,seeds:r.seed_count,dates:r.global_distinct_dates,months:Object.keys(r.months).length}));
