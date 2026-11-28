'use strict';
const a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const smoke=require('../fixtures/minimal.json'),clock=require('../fixtures/clock.json').initial_time;
const zone='Asia/Shanghai',field='history[].at';
const fmt=new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
const hash=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const pad=x=>String(x).padStart(2,'0');
const ym=i=>new Date(Date.UTC(2025,i,1)).toISOString().slice(0,7);
const when=(m,d,h,min)=>ym(m)+'-'+pad(d)+'T'+pad(h)+':'+pad(min)+':00+08:00';
function localDay(value){
 const at=new Date(value);a.ok(Number.isFinite(+at),'Invalid date');
 const parts=Object.fromEntries(fmt.formatToParts(at).map(x=>[x.type,x.value]));
 return [parts.year,parts.month,parts.day].join('-');
}
const cohorts=[
 // Explicit uneven household histories with different activity periods and outcomes.
 {key:'willow',name:'Willow household',visits:[[0,1,8,11,21,'cancel'],[1,17,18,9,52,'keep'],[5,9,23,18,43,'move'],[9,26,27,12,6,'keep'],[12,7,13,8,33,'keep'],[13,21,23,19,12,'cancel'],[17,2,16,11,39,'move'],[20,18,27,20,44,'keep'],[22,23,24,17,9,'cancel']]},
 {key:'cedar',name:'Cedar household',visits:[[2,11,20,14,18,'keep'],[3,18,25,9,40,'cancel'],[4,3,19,20,11,'move'],[8,12,13,17,47,'keep'],[10,4,21,18,28,'keep'],[14,22,23,8,3,'keep'],[16,7,23,14,36,'move'],[21,13,18,20,4,'cancel'],[22,23,24,8,46,'keep']]},
 {key:'fern',name:'Fern household',visits:[[5,9,10,10,29,'keep'],[6,24,26,19,52,'keep'],[7,15,27,12,7,'cancel'],[11,18,29,8,5,'move'],[15,5,6,15,31,'keep'],[18,12,24,18,38,'cancel'],[19,8,20,14,54,'move'],[21,27,28,9,24,'keep'],[23,20,31,20,13,'cancel']]}
];
function generate({key,name,visits}){
 const data={account_id:'repair-'+key,service:smoke.service,constraints:smoke.constraints,
  providers:smoke.providers,slots:smoke.slots.filter(x=>['S1','S2'].includes(x.id)),reservations:[],bookings:[],history:[]};
 for(const [index,[m,day,service,hour,minute,outcome]] of visits.entries()){
  const k=index+1,id=key+'-'+k,move=outcome==='move',cancel=outcome==='cancel';
  const at=when(m,day,hour,minute),provider=data.providers[(k+(key==='cedar'?1:0))%2].id;
  const h=9+(hour+k)%7,min=[0,15,30,45][(k+m)%4];
  const slot={id:'ES-'+id,provider_id:provider,start:when(m,service,h,min),end:when(m,service,h+1,min),estimate_minor:8100+(k*613+m*127)%4700,taken:false};
  const prior=move?{...slot,id:'EP-'+id,start:when(m,service-2,h,min),end:when(m,service-2,h+1,min),estimate_minor:slot.estimate_minor+175}:slot;
  data.slots.push(slot);if(move)data.slots.push(prior);
  const r={id:'ER-'+id,slot_id:prior.id,status:'confirmed'};
  const b={id:'EB-'+id,slot_id:slot.id,status:cancel?'cancelled':'confirmed',origin:r.id};
  data.reservations.push(r);data.bookings.push(b);
  const confirm=service-day>4&&k%3===0?when(m,day+1,8,(minute+37)%60):new Date(Date.parse(at)+(5+k*3)*60000).toISOString();
  data.history.push({operation:'select_slot',object_id:r.id,slot_id:prior.id,at},{operation:'confirm_reservation',object_id:b.id,slot_id:prior.id,at:confirm});
  if(move)data.history.push({operation:'reschedule_booking',object_id:b.id,slot_id:slot.id,prior_slot_id:prior.id,at:when(m,day+(k%3)+2,12,(minute+7)%60)});
  if(cancel)data.history.push({operation:'cancel_booking',object_id:b.id,slot_id:slot.id,
   at:when(m,service===31||service-day<=1?service:service-1,7+(k%2),(minute+17)%60)});
 }
 data.history.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const person='customer-'+key;
 const binding={people:[{person_id:person,name}],accounts:[{app_id:'home-repair-slots',account_id:data.account_id,owner_person_id:person}],
  objects:{'home-repair-slots':[...data.providers,...data.slots,...data.reservations,...data.bookings].map(x=>x.id)}};
 return {binding,virtual_now:clock,data};
}
const seedFile=(index,key)=>index===0?'seed.json':key+'.seed.json';
const manifestFile=(index,key)=>index===0?'dataset.json':key+'.dataset.json';
const writeSource=(file)=>'https://github.com/2018cx/Personal-Agents-Last-Exam/blob/propose-home-repair-slots/apps/home-repair-slots/'+file;
function metadata(profile,source,bundleName){
 const id='synthetic-repair-'+source.key;
 return {schema_version:'pale.dataset.v1',dataset_id:'home-repair-slots-eval-'+source.key,version:'2.0.0',
  description:'Original synthetic cabinet-hinge service activity; one binding and household per seed.',
  record_source_ids:[id],sources:[{source_id:id,kind:'synthetic',description:'Deterministically authored fictional service history; no external account records.',uri:writeSource('evaluation/'+bundleName),license:'MIT',usage:'permitted',
   collection:{method:'Original local synthetic generation, not external collection',collected_at:'2026-11-28T09:22:00Z'},
   generation:{method:'deterministic_rule_based',tool:'evaluation/recount.cjs',tool_version:'2.0.0',seed:source.key,parameters:{sha256:hash(json(profile)),authoritative_date_field:field,counting_zone:zone}}}],
  transformations:['Canonical JSON and stable linked object IDs; count observed booking activity only, not scheduled service dates.'],
  expected_counts:{records:profile.data.slots.length+profile.data.bookings.length,assets:0},
  quality_policy:{duplicate_records:'reject',duplicate_assets:'reject',missing_assets:'allow_declared'},
  review:{status:'pending',reviewer:null,notes:'Xiao Cui (@2018cx) is responsible for provenance. All data is independently authored and synthetic; no independent acceptance is asserted.'}};
}
function recount(entries){
 const months=Object.fromEntries(Array.from({length:24},(_,m)=>[ym(m),{synthetic:0,real:0,dates:new Set(),by_source:{}}]));
 const all=new Set(),sources=[];
 for(const {key,seed,raw,profile} of entries){
  const dates=new Set(),byMonth={},operations={}; let prior=-Infinity;
  for(const h of profile.data.history){
   const t=Date.parse(h.at),day=localDay(h.at),m=day.slice(0,7);
   a.ok(t>=prior&&t<=Date.parse(profile.virtual_now)&&months[m],'History time out of order, in future or out of range');prior=t;
   dates.add(day);all.add(day);
   months[m].synthetic++;months[m].dates.add(day); months[m].by_source[key]=(months[m].by_source[key]||0)+1;
   byMonth[m]=(byMonth[m]||0)+1;operations[h.operation]=(operations[h.operation]||0)+1;
  }
  const xs=[...dates].sort();
  sources.push({id:key,file:seed,sha256:hash(raw),date_field:field,synthetic:profile.data.history.length,real:0,
   distinct_dates:xs.length,observed_window:[xs[0],xs.at(-1)],monthly:byMonth,missing_months:Object.keys(months).filter(m=>!byMonth[m]),operations});
 }
 const xs=[...all].sort();
 for(const m of Object.values(months))m.dates=m.dates.size;
 return {schema:'home-repair-slots.coverage.v2',counting_zone:zone,requested_window:['2025-01-01','2026-12-31'],
  observed_window:[xs[0],xs.at(-1)],distinct_dates:xs.length,missing_months:Object.keys(months).filter(m=>!months[m].synthetic),
  real:0,synthetic:sources.reduce((n,s)=>n+s.synthetic,0),unoccupied_days:730-xs.length,
  exclusions:'Appointment windows, snapshot time and non-dated metadata are not activity.',sources,monthly:months};
}
function main(){
 const write=process.argv.includes('--generate');
 const expected=(f,p)=>{if(write)fs.writeFileSync(path.join(__dirname,f),p);else a.equal(fs.readFileSync(path.join(__dirname,f),'utf8'),p,f+' regeneration differs');};
 const entries=cohorts.map((c,i)=>{
  const profile=generate(c),seed=seedFile(i,c.key),bundle=manifestFile(i,c.key),raw=json(profile);
  expected(seed,raw);expected(bundle,json(metadata(profile,c,seed)));return {key:c.key,seed,bundle,raw,profile};
 });
 const coverage=recount(entries); expected('coverage.json',json(coverage));
 if(!write)process.stdout.write(json(coverage));
}
if(require.main===module)main();
module.exports={localDay,recount,profiles:cohorts.map(({key},i)=>({key,seed:seedFile(i,key),dataset:manifestFile(i,key)}))};
