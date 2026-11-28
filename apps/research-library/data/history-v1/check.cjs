'use strict';
const fs=require('node:fs'),path=require('node:path');
const {assert,context,coverage,sha,mcp}=require('./common.cjs');
async function main(){
 const app=JSON.parse(fs.readFileSync(path.join(__dirname,'scope.json'))).app;
 const base=path.join(__dirname,'generated');
 const file=n=>fs.readFileSync(path.join(base,n));
 const raw=file('activity.jsonl');
 const seedBytes=file('load-seed.json');
 const rows=raw.toString().trimEnd().split('\n').map(x=>JSON.parse(x));
 const pack=JSON.parse(seedBytes);
 const expected=JSON.parse(file('coverage.json'));
 assert.deepEqual(expected,{...coverage(rows),ledger_sha256:sha(raw),load_seed_sha256:sha(seedBytes)});
 assert.ok(rows.every((r,i)=>!i||Date.parse(r.at)>=Date.parse(rows[i-1].at)));
 const p=context(path.resolve(process.argv[2]),app);
 try{
  const proof=await mcp(p,pack,async(q,s)=>{
   if(app==='study'){
    const h=(await q('study.get_history')).history;
    assert.deepEqual(h,s.data.history);
    assert.deepEqual(h.map(r=>r.id),rows.map(r=>r.review_id));
    const epoch=Date.parse('2027-01-08T00:00:00+08:00');
    const date=d=>new Date(epoch+d*86400000+8*3600000).toISOString().slice(0,10);
    for(const [i,r] of h.entries()){
     assert.equal(date(r.day),rows[i].date);
     assert.equal(r.rating.toLowerCase(),rows[i].kind.slice(7));
     assert.equal(date(r.previous_due_day),rows[i].previous_due_date);
     assert.equal(date(r.due_day),rows[i].next_due_date);
    }
    const queue=await q('study.get_queue');
    assert.ok(queue.cards.length>0&&queue.cards.every(c=>c.due_day<=queue.day&&!Object.hasOwn(c,'answer')));
    console.log('Core query: history '+h.length+' reviews, latest '+h.at(-1).id+'; next queue '+queue.cards.length+' cards.');
   }else{
    const library_id='history-library', all=(await q('library.search',{library_id})).records;
    assert.deepEqual(all.map(x=>x.id),rows.filter(r=>r.kind==='import').map(r=>r.record_id));
    const collections=await q('library.list_collections',{library_id});
    assert.deepEqual(collections.collections,s.data.collections);
    const note=rows.slice().reverse().find(r=>r.kind==='save_note');
    const opened=await q('library.get',{library_id,id:note.record_id});
    assert.equal(opened.notes[0].text,note.text);
    const exports=rows.filter(r=>r.kind==='export_citations');
    for(const row of exports){
     const observed=(await q('library.read_export',{library_id,export_id:row.export_id})).export;
     assert.deepEqual(observed.record_ids,row.record_ids);
     assert.deepEqual([...observed.bibtex.matchAll(/^@misc\{([^,]+),/gm)].map(m=>m[1]),row.record_ids);
    }
    await q('library.search',{library_id:'separate-archive'},'permission_denied');
    console.log('Core query: '+all.length+' imported records, '+collections.collections.length+' collections and '+exports.length+' selected-only exports.');
   }
  });
  console.log(proof);
  console.log('Coverage: '+expected.synthetic+' synthetic activities on '+expected.activity_dates+' dates; 24/24 months; '+expected.real+' real.');
 }finally{p.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
