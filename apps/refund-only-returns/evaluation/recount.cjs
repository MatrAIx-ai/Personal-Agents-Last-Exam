'use strict';
const fs=require('node:fs'),path=require('node:path'),a=require('node:assert/strict');
const seedPath=path.join(__dirname,'seed.json');
const digest=x=>require('node:crypto').createHash('sha256').update(x).digest('hex');
const fullClock='2026-12-31T23:59:59Z', firstClock='2025-01-01T00:00:00Z';
const day=86400000,hour=3600000,minute=60000;
const asJson=o=>JSON.stringify(o,null,2)+'\n';
const cp=path.join(__dirname,'coverage.json'), mp=path.join(__dirname,'dataset.json'),tp=path.join(__dirname,'timeline.json');
function generatedTimeline(){
 const products=[
  ['linen-notebook','Linen notebook',2200],['paper-tabs','Paper page tabs',1290],['desk-tray','Bamboo desk tray',3450],
  ['felt-pouch','Felt pen pouch',1890],['reading-light','Clip-on reading light',4290],['brush-set','Watercolor brush set',3800],
  ['archive-folder','Archive folder set',2590],['plant-labels','Recycled plant labels',1150],['gift-wrap','Kraft wrapping set',1980],
  ['steel-bottle','Steel bottle',4980],['letter-kit','Letter-writing kit',2990],['packing-cubes','Fabric packing cubes',5290],
  ['bookstand','Folding bookstand',3590],['seed-journal','Garden journal',2490],['lamp-shade','Paper lamp shade',3260],
  ['desk-mat','Felt desk mat',4690],['field-book','Pocket field notebook',1580],['canvas-bag','Canvas market bag',3290]
 ];
 // Explicit seasonal habits: holiday gifts, back-to-school supplies and quieter weeks.
 const dates=[
  [1,8,22],[18],[2,19,28],[],[11,25],[16],[3,22],[7,19,25],[4,9,27],[15],
  [2,5,18,26],[3,6,14,17,27],[6,30],[12],[9,27,29],[],[7],[9,21,28],
  [13],[2,25],[1,4,10,20],[12,29],[5,10,27,28],[2,6,9,18,31]
 ];
 const receipts=new Map([
  // Keys are one fictional purchase's month index and day. Lags and completion are independent times.
  ['0:8',[4,3,'dispatched',39]], ['0:22',[1,11,'cancelled',10]], ['2:28',[7,5,'dispatched',21]],
  ['4:25',[2,23,'dispatched',51]], ['6:3',[5,9,'cancelled',6]],['7:25',[10,14,'dispatched',35]],
  ['8:9',[3,18,'dispatched',23]], ['10:2',[7,2,'dispatched',37]], ['10:26',[1,16,'cancelled',4]],
  ['11:14',[11,3,'dispatched',30]], ['11:27',[2,10,'dispatched',8]], ['12:30',[3,6,'dispatched',17]],
  ['14:27',[9,11,'dispatched',48]], ['16:7',[1,21,'cancelled',1]], ['17:28',[10,15,'dispatched',15]],
  ['19:2',[5,19,'dispatched',40]], ['20:4',[2,8,'dispatched',32]], ['21:29',[4,7,'cancelled',13]],
  ['22:10',[11,23,'dispatched',27]], ['22:28',[1,4,'dispatched',19]], ['23:6',[4,6,'dispatched',66]],
  ['23:18',[9,21,'dispatched',16]]
 ]);
 let randomState=0x2b8d9061;
 const pick=n=>((randomState=(Math.imul(1664525,randomState)+1013904223)>>>0)>>>8)%n;
 const orders=[],episodes=[],smoke=require('../fixtures/minimal.json');
 for(let m=0;m<dates.length;m++)for(const d of dates[m]){
  const idx=orders.length+1, model=receipts.get(m+':'+d);
  const seasonal=m%12===10||m%12===11?[8,9,10,1,4,7,16,5]:m%12===7||m%12===8?[0,1,2,3,6,12,16,4]:[0,0,4,7,11,13,14,15,17,3,2,16];
  const [,item_name,amount]=products[seasonal[pick(seasonal.length)]];
  const when=Date.UTC(2025,m,d,[0,3,6,10,11,12,13,14,15][pick(9)],pick(60),pick(60));
  // Keep the pre-v2.1 draw positions for dates, prices and initial request timing.
  if(model||pick(6)!==0)pick(3);
  const windowDays=30;
  const priceDeltas=[0,0,0,0,-150,-300,120,80];
  const o={id:'history-'+idx,item_id:'history-item-'+idx,item_name,policy_id:smoke.policy.id,
   ordered_at:new Date(when).toISOString(),return_deadline:new Date(when+windowDays*day).toISOString(),
   refund_minor:amount+priceDeltas[pick(priceDeltas.length)],currency:'CNY',refundable:!!model||pick(7)!==0,order_number:String(20000+idx)};
  orders.push(o);
  if(model){
   const [delayDays,delayHours,outcome,outcomeHours]=model;
   const submitted=when+delayDays*day+delayHours*hour+(3+pick(49))*minute;
   const reviewed=submitted-(2+pick(33))*minute;
   episodes.push({id:'history-request-'+idx,order_id:o.id,attempt:1,created_at:new Date(reviewed).toISOString(),
    submitted_at:new Date(submitted).toISOString(),resolved_at:new Date(submitted+outcomeHours*hour+(1+pick(41))*minute).toISOString(),outcome});
  }
 }
 // Some shoppers retry after cancellation while still within the same policy window.
 const retries=[['history-3',2,8],['history-11',4,13],['history-23',6,6]];
 for(const [orderId,lagDays,lagHours] of retries){
  const initial=episodes.find(e=>e.order_id===orderId&&e.outcome==='cancelled');
  a.ok(initial,'Retry requires an earlier cancelled request: '+orderId);
  const submitted=Date.parse(initial.resolved_at)+lagDays*day+lagHours*hour+19*minute;
  a.ok(submitted<=Date.parse(orders.find(o=>o.id===orderId).return_deadline));
  episodes.push({id:initial.id+'-retry',order_id:orderId,attempt:2,
   created_at:new Date(submitted-7*minute).toISOString(),submitted_at:new Date(submitted).toISOString(),
   resolved_at:new Date(submitted+30*hour+11*minute).toISOString(),outcome:'dispatched'});
 }
 episodes.sort((a,b)=>a.submitted_at.localeCompare(b.submitted_at,'en'));
 return {schema:'refund-only-returns.timeline.v2',source:'synthetic-evaluation',timezone:'UTC',orders,episodes};
}
function profileAt(until=fullClock,timeline=generatedTimeline()){
 if(typeof until!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(until)||!Number.isFinite(Date.parse(until)))throw Error('Use a zoned ISO timestamp.');
 const cut=Date.parse(until);
 if(cut<Date.parse(firstClock)||cut>Date.parse(fullClock))throw Error('Timestamp outside the evaluation window.');
 const virtual_now=new Date(cut).toISOString(),smoke=require('../fixtures/minimal.json');
 const orders=timeline.orders.filter(o=>Date.parse(o.ordered_at)<=cut);
 const ids=new Set(orders.map(o=>o.id));
 // A request is visible only once it was actually submitted. No historical discarded drafts.
 const requests=timeline.episodes.filter(e=>ids.has(e.order_id)&&Date.parse(e.submitted_at)<=cut).map(({resolved_at,outcome,...e})=>
  ({...e,status:Date.parse(resolved_at)<=cut?outcome:'confirmed'}));
 const data={...smoke,policy:{...smoke.policy,version:'1.1',summary:'Eligible items: 30 days from purchase, including the deadline. Cancel before dispatch. Policy-excluded items are not refundable.'},orders,requests};
 const dataset={
  schema_version:'pale.dataset.v1',dataset_id:'refund-only-returns-evaluation-v2',version:'2.1.0',
  description:'Synthetic evaluation history materialized as of '+virtual_now+'.',
  record_source_ids:['synthetic-evaluation'],sources:[{
   source_id:'synthetic-evaluation',kind:'synthetic',description:'Original fictional product names, prices, and order/request episodes. No external records or media.',
   uri:null,license:'MIT',usage:'permitted',collection:null,generation:{
    method:'deterministic_rule_based',tool:'evaluation/recount.cjs',tool_version:'2.1.0',
    seed:'0x2b8d9061',parameters:{counting_zone:'UTC',return_window_days:30,as_of:virtual_now}
   }}],
  transformations:['Cutoff filters future orders and submissions, then projects each submitted request to the latest known status.'],
  expected_counts:{records:orders.length+requests.length,assets:0},
  quality_policy:{duplicate_records:'reject',duplicate_assets:'reject',missing_assets:'allow_declared'},
  review:{status:'pending',reviewer:null,notes:'Xiao Cui (@2018cx) is responsible for human provenance and license review.'}
 };
 return {virtual_now,data,dataset};
}
function report(data,raw){
 const days=new Set(),months=Object.fromEntries(Array.from({length:24},(_,i)=>[
  new Date(Date.UTC(2025,i,1)).toISOString().slice(0,7),{orders:0,requests:0,real:0,synthetic:0,days:new Set()}]));
 for(const [field,kind] of [['ordered_at','orders'],['created_at','requests']]){
  for(const r of data[kind]){
   const date=new Date(r[field]).toISOString().slice(0,10),m=months[date.slice(0,7)];
   a.ok(m,'Date must fall in the two-year window');
   m[kind]++;m.synthetic++;m.days.add(date);days.add(date);
  }
 }
 for(const m of Object.values(months))m.days=m.days.size;
 const dates=[...days].sort();
 return {schema:'refund-only-returns.coverage.v2',source:'synthetic-evaluation',counting_zone:'UTC',
  counted_fields:{orders:'ordered_at',requests:'created_at'},requested_window:['2025-01-01','2026-12-31'],
  observed_window:[dates[0],dates.at(-1)],real:0,synthetic:data.orders.length+data.requests.length,
  distinct_dates:dates.length,missing_months:Object.entries(months).filter(([,m])=>!m.synthetic).map(([k])=>k),
  monthly:months,seed_sha256:digest(raw)};
}
function main(){
 const args=process.argv.slice(2);
 const timeline=generatedTimeline();
 if(args[0]==='--until'&&args.length===2){process.stdout.write(asJson(profileAt(args[1],timeline)));return;}
 if(args.length&&!(args.length===1&&args[0]==='--generate'))throw Error('Usage: recount.cjs [--generate | --until <zoned ISO timestamp>]');
 const {data,dataset}=profileAt(fullClock,timeline),raw=asJson(data),coverage=asJson(report(data,raw));
 const files=[[seedPath,raw],[cp,coverage],[mp,asJson(dataset)],[tp,asJson(timeline)]];
 if(args[0]==='--generate'){for(const [file,value] of files)fs.writeFileSync(file,value);}
 else{
  for(const [file,value] of files)a.equal(fs.readFileSync(file,'utf8'),value,'Regeneration drift: '+path.basename(file));
  process.stdout.write(coverage);
 }
}
if(require.main===module)main();
module.exports={report,profileAt,fullClock};
