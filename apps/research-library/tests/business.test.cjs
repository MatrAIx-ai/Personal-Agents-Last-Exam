'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateSeed,handleTool,applyEvent}=require('../plugin.cjs');
const s=()=>structuredClone(require('../fixtures/minimal.json'));
const c=(now='2027-01-08T08:00:00Z')=>({binding:require('../fixtures/binding.json'),role:'agent',virtual_now:now});
const b={library_id:'group-1'}, item={...b,id:'paper-17'}, event=require('../examples/scenario.json');
const call=(d,n,args,ctx=c())=>handleTool(ctx,d,'library.'+n,args).result;
const denied=(fn,code)=>assert.throws(fn,{code});
const grant=(d,e=event)=>applyEvent({...c(e.at),role:'infra'},d,e);
test('read-only search filters, author privacy and library boundaries',()=>{
 const d=s(), before=structuredClone(d);
 assert.equal(call(d,'search',{...b,query:'Avery',tag:'methods',reading_status:'reading'}).records.length,1);
 assert.deepEqual(call(d,'search',{...b,query:'missing'}).records,[]);
 assert.deepEqual(call(d,'get',item).notes,[]);
 denied(()=>call(d,'search',{library_id:'private-a'}),'permission_denied');
 denied(()=>call(d,'get',{...b,id:'private-1'}),'not_found');
 assert.deepEqual(d,before);
});
test('viewer denied, editor import must be scoped and singular',()=>{
 const d=s(), args={...b,catalog_id:'catalog-18'}, initial=structuredClone(d);
 denied(()=>call(d,'import',args),'permission_denied');assert.deepEqual(d,initial);
 grant(d);
 const {record}=call(d,'import',args);assert.equal(record.catalog_id,'catalog-18');assert.equal(record.revision,1);
 assert.deepEqual(call(d,'get',{...b,id:record.id}).record,record);
 denied(()=>call(d,'import',args),'duplicate_import');
 assert.equal(d.records.length,3);
});
test('edits advance record revision, protect author note, and reject stale or expired form',()=>{
 const d=s();grant(d);
 const {record}=call(d,'save_record',{...item,expected_record_revision:2,patch:{tags:['revised'],reading_status:'read'}});
 assert.equal(record.revision,3);
 denied(()=>call(d,'save_note',{...item,expected_record_revision:2,text:'x'}),'stale_record');
 assert.equal(call(d,'save_note',{...item,expected_record_revision:3,text:'My note'}).note.author,'b');
 assert.deepEqual(call(d,'get',item).notes.map(n=>n.text),['My note']);
 assert.equal(d.notes[0].text,'Check method');
 const before=structuredClone(d);
 denied(()=>call(d,'save_record',{...item,expected_record_revision:4,patch:{title:'Late'}},c('2027-01-08T12:00:00Z')),'session_expired');
 assert.deepEqual(d,before);
});
test('seed rejects broken references and duplicate scope',()=>{
 const d=s();validateSeed(c(),d);
 d.notes.push({record_id:'missing',author:'a',text:'x'});denied(()=>validateSeed(c(),d),'invalid_seed');
 const bad=s();bad.records.push({...bad.records[0],id:'dup'});denied(()=>validateSeed(c(),bad),'invalid_seed');
});
test('permission change cannot be invoked by Agent and leaves other grants intact',()=>{
 const d=s();denied(()=>applyEvent(c(),d,event),'invalid_event');
 const initial=structuredClone(d.libraries[1]);grant(d);
 assert.deepEqual(d.libraries[1],initial);
 denied(()=>grant(d,{...event,payload:{...event.payload,principal_id:'missing'}}),'invalid_event');
});
test('collections are scoped and membership changes neither records nor private notes',()=>{
 const d=s(), before=structuredClone(d);
 assert.deepEqual(call(d,'list_collections',b).collections[0].member_ids,['paper-17']);
 denied(()=>call(d,'create_collection',{...b,name:'Reading'}),'permission_denied');
 assert.deepEqual(d,before); grant(d);
 const created=call(d,'create_collection',{...b,name:' Reading 2 '}).collection;
 assert.equal(created.name,'Reading 2');
 denied(()=>call(d,'rename_collection',{...b,collection_id:created.id,name:'  '}),'invalid_arguments');
 assert.equal(call(d,'rename_collection',{...b,collection_id:created.id,name:'Recent'}).collection.name,'Recent');
 const member={...b,collection_id:created.id,record_id:'paper-17'};
 denied(()=>call(d,'set_membership',{...member,record_id:'private-1',member:true}),'not_found');
 assert.deepEqual(call(d,'set_membership',{...member,member:true}).collection.member_ids,['paper-17']);
 assert.deepEqual(call(d,'set_membership',{...member,member:false}).collection.member_ids,[]);
 assert.deepEqual(d.records,before.records);assert.deepEqual(d.notes,before.notes);
});
test('preview is read-only, BibTeX excludes private and unselected data, and overflow cannot create an artifact',()=>{
 const d=s(), before=structuredClone(d);const chosen={...b,record_ids:['paper-17']};
 const exact='@misc{paper-17,\n  title={Field Notes},\n  author={Avery Example},\n  year={2027}\n}\n';
 assert.equal(call(d,'preview_citations',chosen).bibtex,exact);
 assert.equal(call(d,'get',item).text_preview.status,'available');
 denied(()=>call(d,'export_citations',chosen),'permission_denied');
 denied(()=>call(d,'preview_citations',{...chosen,record_ids:['paper-17','private-1']}),'not_found');
 assert.deepEqual(d,before); grant(d);
 for(let n=0;n<8;n++) {
  const artifact=call(d,'export_citations',chosen).export;
  assert.deepEqual(call(d,'read_export',{...b,export_id:artifact.id}).export,artifact);
  assert.equal(artifact.bibtex,exact);
 }
 denied(()=>call(d,'export_citations',chosen),'capacity_reached');
 const tooBig=s();grant(tooBig);tooBig.records[0].title='😀'.repeat(200);
 tooBig.records[0].authors=Array.from({length:20},()=> '😀'.repeat(200));
 denied(()=>call(tooBig,'export_citations',chosen),'capacity_reached');assert.deepEqual(tooBig.exports,[]);
});
test('trash and restore the same revisioned record, author notes, and collection membership',()=>{
 const d=s();grant(d);const notes=structuredClone(d.notes);
 denied(()=>call(d,'trash_record',{...item,expected_record_revision:1}),'stale_record');
 assert.equal(call(d,'trash_record',{...item,expected_record_revision:2}).record.revision,3);
 assert.deepEqual(call(d,'search',b).records,[]);
 assert.deepEqual(call(d,'list_collections',b).collections[0].member_ids,[]);
 assert.equal(call(d,'list_trash',b).records[0].id,'paper-17');
 denied(()=>call(d,'preview_citations',{...b,record_ids:['paper-17']}),'not_found');
 assert.equal(call(d,'restore_record',{...item,expected_record_revision:3}).record.id,'paper-17');
 assert.deepEqual(call(d,'list_collections',b).collections[0].member_ids,['paper-17']);
 assert.deepEqual(d.notes,notes);
});
test('only Infra corrections change catalog-owned fields, preserving local annotations/membership',()=>{
 const d=s(), before=structuredClone(d);
 const e={event_id:'corr',at:event.at,operation:'library.catalog_correct',payload:{record_id:'paper-17',expected_revision:2,patch:{title:'Field Notes, Revised'}}};
 denied(()=>applyEvent(c(),d,e),'invalid_event');
 denied(()=>grant(d,{...e,payload:{...e.payload,patch:{tags:[]}}}),'invalid_event');
 assert.deepEqual(d,before);
 grant(d,e);
 assert.equal(d.records[0].title,'Field Notes, Revised');
 assert.equal(d.records[0].revision,3);
 assert.deepEqual(d.collections,before.collections);assert.deepEqual(d.notes,before.notes);
 denied(()=>grant(d,e),'invalid_event');
});
