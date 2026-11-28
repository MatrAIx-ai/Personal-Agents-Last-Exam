'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const corpus=path.join(__dirname,'accounts-v1.json'),report=path.join(__dirname,'COVERAGE.md');
const people=['Theo Maren','Ada Solberg','Ivo Calder','Noor Vale','Mina Hartwell','Eli Sato'];
const media=[
 ['After the Ferry','Low-Tide Letters','Kitchen Table Sessions'],
 ['Glass Orchard','The Paper Observatory','Four Lanterns'],
 ['Wait for Dawn','The Quiet Viaduct','Garden Weather'],
 ['Pocket Astronomer','Cedar and Silt','Northbound Trio'],
 ['Blue Courtyard','Canal at Dusk','Seven Small Winters'],
 ['Hidden Bearings','Patterns in Snow','Lights Above Harlow']
];
// Six independently authored timelines. First/last are UTC calendar-month offsets
// from January 2025; each subscriber keeps their own billing anniversary.
const profiles=[
 {first:0,last:12,day:1,hour:0,min:0,saves:[[0,8,20,14],[2,2,6,51],[11,23,14,7]],clock:[12,14,7,18],status:'paid_active',actions:[]},
 {first:3,last:11,day:9,hour:7,min:24,saves:[[3,12,8,30],[4,25,21,5],[10,11,18,17]],clock:[12,9,9,12],status:'free',actions:[['cancel',[9,21,6,49],[9,21,7,3]],['revoke',[9,24,16,21],[9,24,20,35]],['cancel',[11,28,18,41],[11,29,9,27]]]},
 {first:10,last:12,day:19,hour:16,min:6,saves:[[10,19,21,55],[11,4,11,28],[12,22,8,13]],clock:[12,31,18,3],status:'cancellation_scheduled',actions:[['cancel',[12,29,11,38],[12,29,11,45]]]},
 {first:12,last:16,day:26,hour:5,min:53,saves:[[12,28,5,44],[13,18,19,2],[16,27,8,59]],clock:[17,7,16,42],status:'paid_active',actions:[['cancel',[15,2,22,5],[15,2,22,7]],['revoke',[15,18,16,25],[15,19,4,51]]]},
 {first:15,last:21,day:5,hour:13,min:11,saves:[[15,7,8,31],[17,12,20,44],[20,14,16,6]],clock:[22,5,16,33],status:'free',actions:[['cancel',[21,17,10,12],[21,20,8,20]]]},
 {first:19,last:23,day:12,hour:19,min:39,saves:[[19,13,7,15],[21,23,21,52],[23,31,12,6]],clock:[23,31,20,14],status:'paid_active',actions:[['cancel',[21,26,14,6],[21,26,15,51]],['revoke',[22,4,12,27],[22,4,12,30]]]}
];
const t=(m,day,h,min=0)=>new Date(Date.UTC(2025,m,day,h,min)).toISOString();
const floor='2025-01-01T00:00:00.000Z', ceiling='2027-01-01T00:00:00.000Z';
const extraSaves=[
 [['Small Hours',[1,16,6,23]],['June Atlas',[5,9,7,32]],['Harbor Sketches',[14,7,21,1]],['Wren Chorus',[19,3,8,29]],['Night Ferries',[22,16,8,12]]],
 [['Dawn Radio',[6,10,10,21]]],
 [['Late Platform',[11,20,19,32]],['Borrowed Light',[13,7,20,41]]],
 [['First Snow',[15,6,19,11]],['Window Light',[18,5,10,45]],['Cattail Records',[22,21,21,43]]],
 [],[['Field Notes',[20,5,11,0]],['Late Winter',[23,12,22,21]]]
];
const planVisits=[
 [[3,16,18,45],[4,12,7,30],[6,19,21,6],[8,9,14,30],[18,13,8,29]],
 [[5,23,9,25],[7,8,18,14],[11,26,7,25]],
 [[10,24,19,22],[12,27,8,46]],
 [[12,30,17,7],[14,27,11,36],[16,25,22,31],[21,12,18,48]],
 [[16,8,7,19],[19,25,20,14]],
 [[20,13,9,48],[21,24,15,12],[23,6,8,29]]
];
// Complete authored histories, projected at the requested clock. Future renewals
// are metadata only. When replay starts earlier, the existing App still allows
// only one modeled renewal per session, not an indefinite simulation.
const partition=(person,index,until)=>{
 const p=profiles[index],account_id='listener-cohort-'+(index+1),clock=until||t(...p.clock);
 const boundary=m=>t(m,p.day,p.hour,p.min);
 const permanentEnd=p.status==='free'||p.status==='cancellation_scheduled'?boundary(p.last+1):null;
 const joined=clock>=boundary(p.first), ended=permanentEnd&&clock>=permanentEnd;
 let month=p.first;
 while(boundary(month+1)<=clock&&(!permanentEnd||boundary(month+1)<permanentEnd))month++;
 const seed={account_id,status:!joined||ended?'free':'paid_active',
  period_start:joined?boundary(month):floor,period_end:joined?boundary(month+1):boundary(p.first),
  next_period_end:joined?boundary(month+2):boundary(p.first+1),
  phase:ended?1:0,decision_revision:0,ended_at:ended?permanentEnd:null,
  saved:media[index].map((title,i)=>[title,p.saves[i]]).concat(extraSaves[index]).map(([title,when],i)=>({id:'media-'+(i+1),title,saved_at:t(...when)})).filter(r=>r.saved_at<=clock),
  history:[],previews:[],action_receipts:[]};
 const timeline=joined?[{kind:'subscription_started',at:boundary(p.first)}]:[];
 if(joined)for(let j=p.first+1;j<=month;j++)timeline.push({kind:'period_started',at:boundary(j)});
 for(const when of planVisits[index])timeline.push({kind:'plan_reviewed',at:t(...when)});
 if(ended)timeline.push({kind:'paid_access_ended',at:permanentEnd});
 let decision='paid_active';
 for(const [action,created,confirmed] of p.actions){
  const n=seed.previews.length+1, at=t(...confirmed), created_at=t(...created);
  const effective_at=boundary(at<boundary(confirmed[0])?confirmed[0]:confirmed[0]+1);
  if(created_at>clock)break;
  if(!(created_at<=at&&at<effective_at)||((action==='cancel')!==(decision==='paid_active')))throw Error('Invalid authored action');
  // An unconfirmed historical draft is omitted; its future decision must not
  // affect state. Count and binding are computed from the emitted records.
  if(at>clock)break;
  decision=action==='cancel'?'cancellation_scheduled':'paid_active';
  seed.previews.push({id:'SE-P'+n,action,status:'confirmed',phase:0,decision_revision:n-1,created_at});
  seed.action_receipts.push({id:'SE-R'+n,preview_id:'SE-P'+n,action,confirmed_at:at,resulting_status:decision,effective_at});
  timeline.push({kind:action==='cancel'?'cancellation_scheduled':'cancellation_revoked',at});
  seed.decision_revision++;
 }
 if(joined&&!ended)seed.status=decision;
 seed.history=timeline.sort((a,b)=>a.at.localeCompare(b.at)).map((e,i)=>({id:'history-'+(i+1),...e})).filter(e=>e.at<=clock);
 const binding={people:[{person_id:account_id,name:person}],accounts:[{app_id:'subscription-exit',account_id,owner_person_id:account_id}],
  objects:{'subscription-exit':['plan-1',...['saved','history','previews','action_receipts'].flatMap(k=>seed[k].map(r=>r.id))]}};
 return {label:person,virtual_now:clock,binding,seed};
};
const inventoryClock='2026-12-31T23:59:59.999Z';
const generate=()=>JSON.stringify({dataset_id:'subscription-exit-evaluation-v3',source:'original-deterministic-synthetic',timezone:'UTC',
 accounts:people.map((person,i)=>partition(person,i)), inventory:people.map((person,i)=>partition(person,i,inventoryClock))},null,2)+'\n';
function withBundle(row, snapshot, request_id='evaluation-'+row.seed.account_id){
 const base=snapshot.snapshot??snapshot;
 const bundle=structuredClone(base.resources.bundle);
 bundle.dataset={...bundle.dataset,dataset_id:'subscription-exit-evaluation-v3',
   description:'Clock-projected original synthetic evaluation history.',
   expected_counts:{records:['saved','history','previews','action_receipts'].reduce((n,k)=>n+row.seed[k].length,0),assets:0}};
 return {expected_version:snapshot.version??base.version,virtual_now:row.virtual_now,request_id,data:row.seed,binding:row.binding,bundle};
}
function at(account,until){
 const index=people.findIndex((name,i)=>account===name||account==='listener-cohort-'+(i+1));
 if(index<0)throw Error('Unknown account: '+account);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(until??'')||!Number.isFinite(Date.parse(until)))throw Error('Provide an ISO UTC clock with Z.');
 const clock=new Date(until).toISOString();
 if(clock<floor||clock>=ceiling)throw Error('Clock must be in 2025 or 2026 UTC.');
 return partition(people[index],index,clock);
}
function summarize(bytes){
 const x=JSON.parse(bytes),parts={history:'at',saved:'saved_at',action_receipts:'confirmed_at'};
 const interactionKeys=new Set();const totals=Object.fromEntries(Object.keys(parts).map(k=>[k,new Set()])),all=new Set(),counts=new Map();let records=0;
 for(const {seed} of x.inventory)for(const [kind,field] of Object.entries(parts))for(const item of seed[kind]){
  const when=new Date(item[field]).toISOString(),day=when.slice(0,10),month=day.slice(0,7);
  if(day<'2025-01-01'||day>'2026-12-31')throw Error('Unexpected out-of-window date: '+day);
  const c=counts.get(month)||{history:0,saved:0,action_receipts:0,dates:new Set()};
  c[kind]++;c.dates.add(day);counts.set(month,c);records++;interactionKeys.add([seed.account_id,when,kind==='action_receipts'||['cancellation_scheduled','cancellation_revoked'].includes(item.kind)?'decision':item.kind||item.id].join('|'));totals[kind].add(day);all.add(day);
 }
 const dates=[...all].sort(), digest=crypto.createHash('sha256').update(bytes).digest('hex');
 const rows=[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([k,c])=>'| '+[k,c.history,c.saved,c.action_receipts,c.dates.size].join(' | ')+' |').join('\n');
 return '# Subscription Exit evaluation history (v3)\n\n'+
  'Origin: **100% original synthetic, MIT**. No external account data or media; explanation derived from public product documentation only. Synthetic December 2026 records are simulated, not observed. A November real-data anchor does not apply to these fictional private accounts (see #20 delivery review).\n\n'+
  '- Source: `accounts-v1.json`, SHA-256 `'+digest+'`. Six independently bound, overlapping subscriber histories with distinct billing anniversaries, load clocks, saved-entry times and varied cancel/withdrawal patterns. The default partitions have three active paid accounts, one scheduled cancellation, and two ended accounts. Coverage counts the final dated inventory, not the defaults twice; smoke data is excluded.\n'+
  '- Occurrence fields: `history.at`, `saved.saved_at`, `action_receipts.confirmed_at` (UTC); '+records+' dated records; '+interactionKeys.size+' distinct recorded occurrences after coalescing a confirmation receipt with its paired history entry; '+all.size+' global distinct days; '+dates[0]+'–'+dates.at(-1)+'. Distinct dates by record source: '+Object.entries(totals).map(([k,v])=>k+' '+v.size).join(', ')+'.\n'+
  '- '+counts.size+'/24 months. No missing months, malformed or out-of-window counted dates. Preview creation is an intermediate action and excluded; scenario clocks, future period/renewal boundaries and receipt effective dates do not count again.\n'+
  '- Runtime cutoff: run `node evaluation/build.cjs --until 2026-11-20T12:00:00Z --account listener-cohort-4 --snapshot /tmp/infra-snapshot.json` where the input JSON is the public `env.snapshot` result. Pass stdout directly as `env.load_seed` arguments; the bundle and record count match without hand edits. Add a unique `--request-id` when loading repeatedly into the same run. Earlier cutoffs expose only records at or before the clock. Before the authored subscription start, the account is free with no ended subscription and no paid action.\n'+
  '- Recount actual delivered bytes: `node evaluation/build.cjs --check`. Deterministically rebuild the dataset and report: `node evaluation/build.cjs`.\n\n'+
  '| Month | Subscription history | Saved entries | Confirmation receipts | Distinct dates (dedup) |\n| --- | ---: | ---: | ---: | ---: |\n'+rows+'\n';
}
module.exports={at,withBundle};
if(require.main===module){
const args=process.argv.slice(2),arg=key=>args[args.indexOf(key)+1];
if(args.includes('--until')){
 const row=at(arg('--account'),arg('--until'));
 console.log(JSON.stringify(args.includes('--snapshot')?withBundle(row,JSON.parse(fs.readFileSync(arg('--snapshot'),'utf8')),args.includes('--request-id')?arg('--request-id'):undefined):row,null,2));
}else if(process.argv.includes('--check')){
 const bytes=fs.readFileSync(corpus,'utf8'), summary=summarize(bytes);
 if(bytes!==generate()||summary!==fs.readFileSync(report,'utf8'))throw Error('Corpus or report is not reproducible');
 console.log(summary);
}else{
 const bytes=generate();fs.writeFileSync(corpus,bytes);fs.writeFileSync(report,summarize(bytes));
}
}
