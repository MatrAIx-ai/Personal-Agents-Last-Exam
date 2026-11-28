'use strict';
const path=require('node:path');
const {context,engine,manifest,save,mcp,random,DAY,first,last,iso,assert}=require('./common.cjs');
const seed=42027, rng=random(seed);
const topics=['Field interview coding','Longitudinal note taking','Community archive indexing','Cross-site sampling','Citation revision','Research notebook design','Collection deduplication','Qualitative codebooks','Pilot survey logistics','Annotation reliability','Consent record tracking','Library handoff practices'];
const approaches=['A pilot protocol for','A small-team guide to','Reproducibility notes on','An annotated example of','A comparison checklist for','Common pitfalls in'];
const authors=['Aster Example','Rowan Example','Sage Example','Linden Example','Quill Example','Reed Example','Ash Example','Fern Example','Marlow Example'];
const catalog=topics.flatMap((t,i)=>approaches.map((a,j)=>({id:'source-'+(i*6+j+1),title:a+' '+t.toLowerCase(),authors:[authors[(i+j)%authors.length]],year:2016+((i+2*j)%9)})));
const annotations=[
 'Check whether the pilot sample and the comparison sample used the same inclusion rule.',
 'Keep the data-collection assumptions beside the method summary for the next team handoff.',
 'Compare this protocol with the earlier checklist before reusing the coding categories.',
 'The definition in the methods section is narrower than the label in the summary table.',
 'Flag for the reading group: does the result hold when annotations are reviewed independently?',
 'Keep this as background, not evidence for the final estimate.',
 'Use the worked example as a template; record any changes in the study notebook.',
 'Revisit the exclusions before adding this source to the final reading list.',
 'Split the practical recommendation from the claim that still needs a primary source.',
 'The next draft should separate observations made during the pilot from later edits.'
];
const library_id='history-library', data={account_id:'history-owner',session_expires_at:'2027-12-31T12:00:00Z',libraries:[{id:library_id,grants:[{principal_id:'reader-example',role:'editor'}]},{id:'separate-archive',grants:[{principal_id:'archivist-example',role:'editor'}]}],records:[],catalog,notes:[],collections:[],exports:[],trash:[],previews:[]};
const binding={people:[{person_id:'reader-example',name:'Reader Example'},{person_id:'archivist-example',name:'Archivist Example'}],accounts:[{app_id:'library',account_id:data.account_id,owner_person_id:'reader-example'}],objects:{library:[]}};
const source='authored-synthetic';
async function main(){
 const p=context(path.resolve(process.argv[2]),'research-library');
 try{
  const e=engine(p,data,binding,manifest('library-history-origin',0,seed,'Deterministic calendar and authored source catalog'));
  const rows=[];
  const names=['Fieldwork methods','Reading group','Candidate citations','Draft references'];
  const actions=(date,name,args,details)=>{const r=e.mutation('agent','library.'+name,{library_id,...args});rows.push({date,at:e.state().virtual_now,source,kind:name,...details(r)});return r;};
  let actorDates=0,imported=0;
  for(let t=first;t<=last;t+=DAY){
   const date=iso(t), d=new Date(t), w=d.getUTCDay(), m=d.getUTCMonth(), day=d.getUTCDate();
   const cut=m===11&&day>=23?23:m===7?49:64;
   if(t!==first&&t!==last&&rng(100)>cut-([0,6].includes(w)?29:0))continue;
   actorDates++;
   e.advance(date,['09:15:00','12:40:00','18:30:00','21:05:00'][rng(4)]);
   let state=e.state().data;
   if(state.collections.length<names.length && actorDates%3===1){
    actions(date,'create_collection',{name:names[state.collections.length]},r=>({collection_id:r.collection.id,name:r.collection.name}));
    state=e.state().data;
   }
   if(imported<catalog.length && (state.records.length===0||actorDates%5===1)){
    const c=catalog[(imported*17)%catalog.length];imported++;
    actions(date,'import',{catalog_id:c.id},r=>({record_id:r.record.id,catalog_id:c.id}));
    state=e.state().data;
   }
   const record=state.records[rng(state.records.length)], pick=rng(100);
   const col=state.collections[rng(state.collections.length)];
   if(actorDates%46===0&&state.exports.length<7){
    const record_ids=[record.id,...(state.records.filter(x=>x.id!==record.id).slice(-2).map(x=>x.id))];
    actions(date,'export_citations',{record_ids},r=>({export_id:r.export.id,record_ids}));
   }else if(pick<30){
    const member=!col.member_ids.includes(record.id);
    actions(date,'set_membership',{collection_id:col.id,record_id:record.id,member},()=>({collection_id:col.id,record_id:record.id,member}));
   }else if(pick<80){
    const previous=state.notes.find(x=>x.record_id===record.id);
    const text=annotations[(rng(annotations.length)+actorDates)%annotations.length]+' ['+date+'; '+record.title+']';
    assert.notEqual(text,previous?.text);
    actions(date,'save_note',{id:record.id,expected_record_revision:record.revision,text},r=>({record_id:record.id,revision:r.record.revision,text}));
   }else{
    const reading_status={unread:'reading',reading:'read',read:'reading'}[record.reading_status];
    actions(date,'save_record',{id:record.id,expected_record_revision:record.revision,patch:{reading_status}},r=>({record_id:record.id,revision:r.record.revision,reading_status}));
   }
   if([96,213].includes(actorDates)){
    const name=actorDates===96?'Fieldwork protocols':'Draft and submission references';
    const chosen=e.state().data.collections[actorDates===96?0:3];
    actions(date,'rename_collection',{collection_id:chosen.id,name},()=>({collection_id:chosen.id,name}));
   }
  }
  const s=e.state();
  const audit=s.audit.filter(x=>x.actor==='agent'&&x.state_changed&&x.decision==='allow');
  assert.deepEqual(audit.map(x=>[x.virtual_time,x.tool]),rows.map(x=>[x.at,'library.'+x.kind]));
  const bundle={...s.resources.bundle,dataset:manifest('research-library-history-2025-26',s.data.records.length,seed,'Deterministic varied study calendar with chronological Core replay of imports, annotation updates, collection edits and citation exports')};
  const pack={data:s.data,binding:{...binding,objects:{library:s.data.records.map(x=>x.id)}},bundle,virtual_now:'2027-01-08T08:00:00+08:00'};
  const proof=await mcp(p,pack,async (q)=>{
   assert.equal((await q('library.search',{library_id})).records.length,s.data.records.length);
   assert.deepEqual((await q('library.list_collections',{library_id})).collections,s.data.collections);
   const note=s.data.notes.at(-1);
   assert.deepEqual((await q('library.get',{library_id,id:note.record_id})).notes,[note]);
   const selected=s.data.exports.at(-1);
   assert.deepEqual((await q('library.read_export',{library_id,export_id:selected.id})).export,selected);
   await q('library.search',{library_id:'separate-archive'},'permission_denied');
  });
  save(path.resolve(process.argv[3]),pack,rows);
  console.log(proof+' Matched '+audit.length+' dated business writes against Core audit.');
 }finally{p.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
