'use strict';
// Independent authored scenarios, deterministically varied and executed through
// the public plugin. No real guest data, filler records or external services.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const app = path.resolve(__dirname, '..');
const output = path.join(app, 'datasets');
const baselinePath = path.join(app, 'fixtures/minimal.json');
const baselineBytes = fs.readFileSync(baselinePath);
const baseline = JSON.parse(baselineBytes);
const binding = require('../fixtures/binding.json');
const copy = value => structuredClone(value);
const iso = value => new Date(value).toISOString().replace('.000Z', 'Z');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const dayMs = 86400000, minuteMs = 60000;
const periodStart = Date.parse('2025-01-01T00:00:00Z');
const timezone = baseline.property.timezone;
const patterns = [
  ['arrival-mismatch', 'The confirmed entrance window ends before the updated arrival; the original hotel promise and its request history remain visible.'],
  ['route-unavailable', 'A named traveler has an acknowledged and confirmed step-free request followed by a dated route-unavailable notice.'],
  ['breakfast-partial', 'The hotel acknowledged two requested mornings but confirmed only one; the other morning remains unresolved.'],
  ['guest-replaced', 'A different current companion replaces the traveler whose breakfast request was already acknowledged and confirmed; the former service is still active.']
];
const meals = ['Plant-based breakfast', 'No dairy ingredients', 'No peanuts in the prepared breakfast', 'Plain porridge with fruit separately', 'No egg ingredients', 'Breakfast without sesame ingredients'];
function localInstant(year, month, day, hour, minute=0) {
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(utc).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const offset = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second) - utc;
  return utc - offset;
}
function dateOf(year,month,day) {return iso(Date.UTC(year,month-1,day)).slice(0,10);}
function shifted(value, delta) {
  if (Array.isArray(value)) return value.map(v=>shifted(v,delta));
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shifted(v,delta)]));
  if (typeof value==='string' && /^\d{4}-\d{2}-\d{2}(T.*Z)?$/.test(value)) {
    const next=iso(Date.parse(value.length===10?value+'T00:00:00Z':value)+delta);
    return value.length===10?next.slice(0,10):next;
  }
  return value;
}
function scenario(year,month,slot) {
  const index=((year-2025)*12+month-1)*4+slot;
  const cycle=(year-2025)*12+month-1;
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  let date=slot===0?3+(cycle*3)%5:slot===1?10+(cycle*2)%6:slot===2?18+(cycle*5)%6:last-4+(cycle%3);
  if(year===2025&&month===1&&slot===0)date=3;
  if(year===2026&&month===12&&slot===3)date=29;
  const checkIn=localInstant(year,month,date,14+((index+cycle)%4),(cycle%2)*30);
  const checkOut=localInstant(year,month,date+2,9+((index+cycle)%4),(index%2)*30);
  const delta=Date.UTC(year,month-1,date)-Date.parse(baseline.stay.check_in.slice(0,10));
  let data=shifted(baseline,delta);
  const id=`${year}-${String(month).padStart(2,'0')}-${patterns[slot][0]}`;
  const companion=(cycle+slot)%2?'person-3':'person-2',replacement=companion==='person-2'?'person-3':'person-2';
  data.stay.check_in=iso(checkIn);data.stay.check_out=iso(checkOut);
  data.stay.guest_person_ids=['person-1',companion];data.stay.guest_revision=1;
  data.requests=[];data.commitments=[];data.history=[];
  const arrivalTime=localInstant(year,month,date,20+(cycle%2),[10,25,40,55][(index+cycle*3)%4]);
  const window={start:iso(checkIn),end:iso(checkOut)};
  data.property.routes.find(r=>r.id==='east-step-free').window=copy(window);
  data.property.routes.find(r=>r.id==='front-steps').window={start:iso(checkIn-6*3600000),end:iso(checkOut+6*3600000)};
  const leadDays=[2,3,4,6,8,11][(cycle+slot*2)%6];
  let cursor=Math.max(localInstant(year,month,date-leadDays,8+(index%8),[5,20,35,50][cycle%4]),periodStart+8*3600000);
  const observationBase=Math.max(periodStart+5*3600000,cursor-(4+(index%17))*3600000);
  for(let i=0;i<data.sources.length;i++) {
    const source=data.sources[i];source.version=1;source.grant_version=1;
    source.observed_at=iso(Math.min(cursor-60000,observationBase+i*(11+(cycle%13))*minuteMs));
    source.provenance={app_id:'fixture',object_id:`${id}:${source.id}`,observed_version:'1'};
    if(source.fields.arrival_at)source.fields.arrival_at=iso(arrivalTime);
    if(source.fields.meal_request)source.fields.meal_request=meals[(index+i+cycle)%meals.length];
  }
  for(const need of data.needs) {
    need.revision=1;need.review_required=false;
    need.source_versions=need.source_ids.map(source_id=>({source_id,version:1,grant_version:1}));
    if(need.service==='late_arrival') {need.person_ids=copy(data.stay.guest_person_ids);need.conditions.person_ids=copy(need.person_ids);need.conditions.arrival_at=iso(arrivalTime);}
    if(need.service==='step_free_access')need.conditions.window=copy(window);
    if(need.service==='breakfast') {need.conditions.morning_dates=[dateOf(year,month,date+1),dateOf(year,month,date+2)];need.conditions.meal_request=data.sources.find(s=>s.id===need.source_ids[0]).fields.meal_request;}
  }
  const ctx={app_id:'stayready',run_id:'dataset-authoring',role:'agent',binding:copy(binding),virtual_now:iso(cursor)};
  plugin.validateSeed(ctx,data);
  const byNeed=id=>data.needs.find(n=>n.id===id);
  function call(name,args){const result=plugin.handleTool(ctx,data,'stayready.'+name,args);data=result.data;return result.result;}
  function event(value){ctx.virtual_now=value.at;data=plugin.applyEvent({...ctx,role:'infra'},data,value);}
  function advance(value){cursor=value;ctx.virtual_now=iso(value);}
  function promised(need) {
    if(need.service==='late_arrival')return {stay_id:data.stay.id,service:need.service,person_ids:copy(need.person_ids),arrival_window:{start:iso(arrivalTime-45*minuteMs),end:iso(arrivalTime+50*minuteMs)},entrance_id:'east',access_method_id:cycle%2?'night-desk':'staff-meeting'};
    if(need.service==='step_free_access')return {stay_id:data.stay.id,service:need.service,person_ids:copy(need.person_ids),route_id:'east-step-free',window:copy(window)};
    return copy(need.conditions);
  }
  let sequence=0;
  function request(need_id,outcome='confirmed',overrides=null) {
    sequence++;
    const need=byNeed(need_id),args={need_id,action:'arrange'},conditions=copy(need.conditions),submitted=cursor;
    const preview=call('request.preview',args).preview;call('request.submit',{...args,preview_token:preview.preview_token});
    const ackAt=submitted+(7+(index+sequence*3)%37)*minuteMs;
    const target={need_id,action:'arrange',request_conditions:conditions,submitted_in:{from:iso(submitted-1),until:iso(ackAt)}};
    event({event_id:`${id}-request-${sequence}-ack`,at:iso(ackAt),operation:'stayready.hotel_reply',payload:{target:copy(target),outcome:'acknowledged',message:'The property has received this specific service request.'}});
    const finalAt=ackAt+(35+(index*7+sequence*17)%150)*minuteMs;
    const hotelTerms=overrides||promised(need);
    if(outcome==='withdrawn') {advance(finalAt);call('request.withdraw',{hotel_request_id:data.requests.at(-1).id});}
    else event({event_id:`${id}-request-${sequence}-reply`,at:iso(finalAt),operation:'stayready.hotel_reply',payload:{target:copy(target),outcome,...(outcome==='confirmed'?{terms:copy(hotelTerms)}:{}),message:outcome==='confirmed'?'The stated service terms are confirmed.':outcome==='declined'?'The requested service cannot be provided on these terms.':'Please clarify this request before the property can commit.'}});
    advance(finalAt+(15+(index%19))*minuteMs);
    return {need_id,terms:hotelTerms,confirmed_at:iso(finalAt)};
  }
  // Every seed contains an actual request -> acknowledgment -> confirmation.
  const ownerAccess=request('need-access-person-1');
  let focus;
  if(slot===0) {
    focus=request('need-arrival');
    const delayed=localInstant(year,month,date+(cycle%2),cycle%2?0:23,[5,20,35,50][cycle%4]);
    event({event_id:`${id}-arrival-update`,at:iso(cursor),operation:'stayready.source_updated',payload:{source_id:'source-arrival',expected_source_version:1,source_version:2,arrival_at:iso(delayed)}});
    const need=byNeed('need-arrival');call('need.save',{need_id:need.id,conditions:{...need.conditions,arrival_at:iso(delayed)},source_ids:need.source_ids});
  } else if(slot===1) focus=request('need-access-'+companion);
  else if(slot===2) {
    const subject=cycle%2?'person-1':companion,n=byNeed('need-breakfast-'+subject);
    focus=request(n.id,'confirmed',{...copy(n.conditions),morning_dates:[n.conditions.morning_dates[cycle%2]]});
  } else {
    focus=request('need-breakfast-'+companion);
    call('people.replace',{old_person_id:companion,new_person_id:replacement});
  }
  // Additional histories provide refusals, unanswered clarifications and withdrawn
  // requests without manufacturing extra reservations or random log filler.
  const extras=(cycle+slot)%3;
  const candidates=['need-breakfast-person-1','need-breakfast-'+data.stay.guest_person_ids[1],'need-arrival'].filter(id=>!data.commitments.some(c=>c.need_id===id));
  for(let i=0;i<extras;i++) {
    const need=byNeed(candidates[i]);
    if(need.review_required)call('need.save',{need_id:need.id,conditions:need.conditions,source_ids:need.source_ids});
    request(need.id,['declined','needs_clarification','withdrawn'][(cycle+slot+i)%3]);
  }
  if(slot===1) {
    const target=cycle%2?ownerAccess:focus;
    const recorded=Math.max(cursor,checkIn-(3+(cycle%4))*3600000);
    const effective=checkIn-(cycle%3)*30*minuteMs;
    event({event_id:`${id}-route-notice`,at:iso(recorded),operation:'stayready.service_unavailable',payload:{target:{need_id:target.need_id,commitment_terms:copy(target.terms),confirmed_in:{from:iso(Date.parse(target.confirmed_at)-1),until:iso(Date.parse(target.confirmed_at)+1)}},effective_at:iso(effective),reason:cycle%2?'The lift on the confirmed east route is unavailable.':'The named east corridor is closed for maintenance.'}});
    focus=target;
  }
  const virtualNow=iso(checkIn+(2+(cycle%3))*3600000+(slot%2)*30*minuteMs);
  plugin.validateSeed({...ctx,virtual_now:virtualNow},data);
  return {id,data,virtualNow,pattern:patterns[slot][0],description:patterns[slot][1],focus_need_id:focus.need_id,
    variation:{check_in_local_day:date,planned_lead_days:leadDays,initial_companion:companion,current_companion:data.stay.guest_person_ids[1],former_companion:slot===3?companion:null,request_count:data.requests.length,request_statuses:data.requests.map(r=>r.status)}};
}
function generate() {
  fs.mkdirSync(path.join(output,'seeds'),{recursive:true});
  const entries=[];
  for(let year=2025;year<=2026;year++)for(let month=1;month<=12;month++)for(let slot=0;slot<4;slot++) {
    const item=scenario(year,month,slot),file=`seeds/${item.id}.json`,bytes=json(item.data);
    fs.writeFileSync(path.join(output,file),bytes);
    entries.push({scenario_id:item.id,file,sha256:hash(bytes),bytes:Buffer.byteLength(bytes),kind:'synthetic',source_id:'authored-scenario-library',pattern:item.pattern,description:item.description,initial_time:item.virtualNow,account_id:item.data.account_id,stay_check_in:item.data.stay.check_in,stay_check_out:item.data.stay.check_out,focus_need_id:item.focus_need_id,variation:item.variation,
      record_counts:{property:1,stay:1,...Object.fromEntries(['people','sources','needs','requests','commitments','history'].map(k=>[k,item.data[k].length]))}});
  }
  const inputs=['fixtures/minimal.json','fixtures/binding.json','plugin.cjs','tools.json',...fs.readdirSync(path.join(app,'src')).filter(f=>f.endsWith('.cjs')).map(f=>'src/'+f),...['seed','conditions','terms','events'].map(f=>'schemas/'+f+'.schema.json')].sort().map(file=>({file,sha256:hash(fs.readFileSync(path.join(app,file)))}));
  const total=entries.reduce((sum,e)=>sum+Object.values(e.record_counts).reduce((a,b)=>a+b,0),0);
  const manifest={dataset_id:'stayready-evaluation-2025-2026',version:'2.0.0',timezone,coverage_window:{from:'2025-01-01',through:'2026-12-31'},expected_counts:{scenarios:entries.length,records:total,assets:0},
    generation:{method:'Deterministic authored variation in local dates, arrival/check-in times, observation and reply lead times, companion assignments and 2–4 causal request/acknowledgment/reply histories per run, executed through the public plugin.',generated_on:'2026-11-28',script:'scripts/generate-dataset.cjs',script_sha256:hash(fs.readFileSync(__filename)),baseline:'fixtures/minimal.json',baseline_sha256:hash(baselineBytes),random_seed:null,inputs},
    provenance:{source_id:'authored-scenario-library',kind:'synthetic',license:'MIT',real_guest_records:0,mixed_guest_records:0,statement:'All hotel, traveler, source, request, reply and event records are authored fiction. The fixed property and three-person pool implement the approved one-property/two-guest scope; dates, assignments, timing and causal histories vary independently across isolated runs. No real-data anchor is claimed or required.',future_dates:'Dates after authoring are explicitly synthetic prospective scenarios, never observations of actual future activity.',record_identity:'scenario_id plus record_type plus record id; App-local IDs are intentionally reused only across isolated runs.'},scenarios:entries};
  fs.writeFileSync(path.join(output,'manifest.json'),json(manifest));
  const declaration={schema_version:'pale.dataset.v1',dataset_id:manifest.dataset_id,version:manifest.version,description:'The delivered synthetic Environment evaluation library: 96 independent fixed two-night hotel scenarios across 2025–2026, with real plugin-generated request/acknowledgment/reply histories and deterministic business variation.',record_source_ids:['authored-scenario-library'],sources:[{source_id:'authored-scenario-library',kind:'synthetic',description:manifest.provenance.statement,uri:'manifest.json',license:'MIT',usage:'permitted',collection:null,generation:{method:manifest.generation.method,tool:'scripts/generate-dataset.cjs + public StayReady plugin',tool_version:'2.0.0',seed:null,parameters:{manifest:'manifest.json',scenario_count:96,timezone,coverage_window:manifest.coverage_window,records:total}}}],transformations:['All timestamps are stored as UTC instants; date coverage is counted in the property IANA timezone.','Requests, acknowledgments, final replies, source changes and companion replacements are executed through the public plugin before seed export.','Evaluation labels are stored in manifest metadata, not in public business seed records.'],expected_counts:{records:total,assets:0},quality_policy:{duplicate_records:'reject',duplicate_assets:'reject',missing_assets:'allow_declared'},review:{status:'pending',reviewer:null,notes:'Synthetic records are acceptable without a real-data anchor; independent review of causal realism and variation remains required.'}};
  fs.writeFileSync(path.join(output,'declaration.json'),json(declaration));
  const minimal=JSON.parse(fs.readFileSync(path.join(app,'contribution/dataset.json')));
  minimal.description='Runtime baseline (20 records) and the delivered 96-scenario synthetic evaluation library coexist. The formal full-library declaration is ../datasets/declaration.json and its loadable seed index is ../datasets/manifest.json. Top-level expected_counts describes only the runtime-loaded baseline, as required by the public bundle contract.';
  minimal.sources=minimal.sources.filter(s=>s.source_id!=='authored-scenario-library');
  minimal.sources.push({source_id:'authored-scenario-library',kind:'synthetic',description:`Delivered evaluation dataset ${manifest.dataset_id}: 96 scenarios and ${total} synthetic records; no real guest records or real-data anchor.`,uri:'../datasets/declaration.json',license:'MIT',usage:'permitted',collection:null,generation:{method:manifest.generation.method,tool:'scripts/generate-dataset.cjs + public StayReady plugin',tool_version:'2.0.0',seed:null,parameters:{dataset_id:manifest.dataset_id,declaration:'../datasets/declaration.json',manifest:'../datasets/manifest.json',expected_counts:{scenarios:96,records:total,assets:0},timezone}}});
  fs.writeFileSync(path.join(app,'contribution/dataset.json'),json(minimal));
  console.log(JSON.stringify({scenarios:entries.length,records:total,timezone,requests:entries.reduce((n,e)=>n+e.record_counts.requests,0),history:entries.reduce((n,e)=>n+e.record_counts.history,0)},null,2));
}
if(require.main===module)generate();
module.exports={scenario,generate};
