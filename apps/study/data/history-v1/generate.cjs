'use strict';
const path=require('node:path'),{context,engine,manifest,save,mcp,random,DAY,first,last,iso,assert}=require('./common.cjs');
const seed=51027,rng=random(seed), origin=Date.parse('2027-01-08T00:00:00+08:00');
const localDay=date=>Math.floor((Date.parse(date+'T00:00:00+08:00')-origin)/DAY);
const lessons=[
 ['travel','Travel routines',[
  ['The stop after the bridge','La parada después del puente'],['Does this bus go downtown?','¿Este autobús va al centro?'],
  ['We need two round-trip tickets.','Necesitamos dos billetes de ida y vuelta.'],['The platform has changed.','Han cambiado el andén.'],
  ['I left my bag at reception.','Dejé mi bolsa en recepción.'],['Is there a quieter room?','¿Hay una habitación más tranquila?'],
  ['The train is running late.','El tren lleva retraso.'],['I will meet you by the exit.','Te espero junto a la salida.']
 ]],
 ['daily','Daily errands',[
  ['Could you put it in a paper bag?','¿Lo puede poner en una bolsa de papel?'],['I am looking for a smaller size.','Busco una talla más pequeña.'],
  ['Please leave the parcel downstairs.','Deje el paquete abajo, por favor.'],['Do they close at noon?','¿Cierran al mediodía?'],
  ['The repair can wait until Monday.','La reparación puede esperar hasta el lunes.'],['I paid by card yesterday.','Ayer pagué con tarjeta.'],
  ['Let me check the receipt.','Déjeme revisar el recibo.'],['There was no change left.','No quedaba cambio.']
 ]],
 ['study','Study conversations',[
  ['Which part should we review first?','¿Qué parte debemos repasar primero?'],['I wrote it down in my notes.','Lo apunté en mis notas.'],
  ['Can we compare the two examples?','¿Podemos comparar los dos ejemplos?'],['That rule has an exception.','Esa regla tiene una excepción.'],
  ['I still mix up the two endings.','Todavía confundo las dos terminaciones.'],['Let me try without looking.','Déjame intentarlo sin mirar.'],
  ['We can finish this section tomorrow.','Podemos terminar esta sección mañana.'],['Could you explain your reasoning?','¿Puedes explicar tu razonamiento?']
 ]]
];
const decks=lessons.map(([id,name])=>({id,name}));
const cards=Array.from({length:24},(_,i)=>{
 const [deck_id,,pairs]=lessons[i%3],[prompt,answer]=pairs[Math.floor(i/3)];
 return {id:'hist-card-'+String(i+1).padStart(2,'0'),deck_id,prompt,answer,reviewed:false,stage:0,due_day:localDay(iso(first+i*27*DAY)),card_version:1,suspended:false};
});
const data={account_id:'study-history',owner_person_id:'learner-history',decks,cards,plan:{id:'plan-history',deck_ids:decks.map(d=>d.id),daily_limit:12,new_limit:1,target_day:14,revision:1},history:[],session:null,notices:[]};
const binding={people:[{person_id:'learner-history',name:'Learner Example'}],accounts:[{app_id:'study',account_id:data.account_id,owner_person_id:data.owner_person_id}],objects:{study:[...decks,...cards,data.plan].map(x=>x.id)}};
async function main(){
 const p=context(path.resolve(process.argv[2]),'study');
 try{
  const dataset=manifest('study-history-2025-26',cards.length,seed,'Deterministic calendar and spaced practice through the App’s actual queue and scheduler; authored English and Spanish prompts');
  const e=engine(p,data,binding,dataset,'sandbox'), rows=[];
  const queue=()=>e.call('agent','study.get_queue',{},'ok').cards;
  const delay=[1,1,3,7];
  const read=e.state;
  let n=0;
  for(let t=first;t<=last;t+=DAY){
   const d=new Date(t), date=iso(t), w=d.getUTCDay(), m=d.getUTCMonth(), dm=d.getUTCDate(), day=localDay(date);
   const cutoff=m===7?52:m===11&&dm>24?41:67;
   if(t!==first&&t!==last&&rng(100)>cutoff-([0,6].includes(w)?31:0))continue;
   if(!read().data.cards.some(c=>c.due_day<=day))continue;
   e.advance(date,['07:25:00','12:10:00','19:45:00','21:05:00'][rng(4)]);
   const k=1+(rng(100)<63?1:0)+(rng(100)<14?1:0);
   for(let j=0;j<k;j++){
    const q=queue();
    if(!q.length)break;
    // Occasionally start a newly released card rather than reviewing only overdue cards.
    const c=(j===0&&rng(100)<46?q.find(x=>!x.reviewed):null)||q[0];
    const rating=rng(100)<(c.reviewed?[28,20,14,9][c.stage]:31)?'Again':'Good';
    const r=e.mutation('agent','study.record_review',{card_id:c.id,card_version:c.card_version,review_day:day,rating}).review;
    assert.equal(r.due_day,day+delay[r.stage]);assert.ok(r.previous_due_day<=day);
    n++; assert.ok(n<1000);
    rows.push({date,at:read().virtual_now,source:'authored-synthetic',kind:'review-'+rating.toLowerCase(),deck_id:c.deck_id,review_id:r.id,card_id:c.id,was_new:r.was_new,previous_stage:r.previous_stage,stage:r.stage,previous_due_date:iso(first+(r.previous_due_day-localDay('2025-01-01'))*DAY),next_due_date:iso(first+(r.due_day-localDay('2025-01-01'))*DAY)});
   }
  }
  const s=read(), history=s.data.history;
  assert.equal(history.length,rows.length);
  assert.deepEqual(s.audit.filter(x=>x.tool==='study.record_review'&&x.decision==='allow').map(x=>x.virtual_time),rows.map(x=>x.at));
  assert.ok(new Set(history.filter(x=>x.was_new).map(x=>x.card_id)).size >= 18);
  for(const c of s.data.cards){
   const h=history.filter(r=>r.card_id===c.id);
   if (!h.length) { assert.equal(c.reviewed,false); continue; }
   assert.equal(h[0].was_new,true);assert.equal(c.due_day,h.at(-1).due_day);
   for(let i=1;i<h.length;i++){assert.equal(h[i].previous_due_day,h[i-1].due_day);assert.ok(h[i].day>h[i-1].day);}
  }
  const pack={data:s.data,binding,bundle:{...s.resources.bundle,dataset},virtual_now:'2027-01-01T08:00:00+08:00'};
  const proof=await mcp(p,pack,async q=>{
   const queried=await q('study.get_history');assert.deepEqual(queried.history,history);
   assert.equal(queried.undoable_review_id,null);
   const observed=await q('study.get_queue');assert.equal(observed.day,localDay('2027-01-01'));
   const due=observed.cards;assert.ok(due.length&&due.every(c=>c.due_day<=observed.day&&c.answer===undefined));
  });
  save(path.resolve(process.argv[3]),pack,rows);
  console.log(proof+' Checked '+history.length+' dated scheduler transitions and per-card due-date chains.');
 }finally{p.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
