'use strict';
// Trusted local fictional providers use only the public Infra MCP interface.
const {makeReply}=require('../src/provider.cjs');
async function tick(infra){
 const first=await infra.call('env.snapshot');if(first.status!=='ok')throw Error(first.message||'Snapshot unavailable.');const pending=first.snapshot.data.applications.filter(a=>a.status==='pending').map(a=>a.id);
 async function event(operation,payload,event_id){const s=await infra.call('env.snapshot'),r=await infra.call('env.apply_event',{expected_version:s.version,event:{event_id,at:s.snapshot.virtual_now,operation,payload}});if(r.status!=='committed')throw Error(r.message||r.status);return r;}
 for(const id of pending){let s=await infra.call('env.snapshot'),d=s.snapshot.data,app=d.applications.find(a=>a.id===id);if(app.status!=='pending')continue;const v=app.versions.find(v=>v.revision===app.revision),disclosure=d.disclosures.find(x=>x.id===v.disclosure_id),provider=d.providers.find(p=>p.id===app.provider_id),rule=provider.rules.filter(r=>Date.parse(r.effective_at)<=Date.parse(s.snapshot.virtual_now)).sort((a,b)=>b.revision-a.revision)[0],base=app.id+'-r'+app.revision;
  if(disclosure.payload.vehicle_use==='business'||disclosure.payload.drivers?.every(p=>p.excluded)){await event('auto.application_declined',{provider_id:provider.id,application_id:app.id,application_revision:app.revision,reason:'This synthetic product requires an included driver and personal/commute use.',source_ref:provider.id+'-decision-'+base},'decline-'+base);continue;}
  let question=d.requests.find(q=>q.application_id===id&&q.application_revision===app.revision&&q.fields.includes('annual_mileage'));
  if(rule.ask_mileage&&!question){await event('auto.information_requested',{provider_id:provider.id,application_id:app.id,application_revision:app.revision,request_id:'question-'+base,fields:['annual_mileage'],question:'Please confirm annual mileage from the supplied owner source.',reply_by:new Date(Date.parse(s.snapshot.virtual_now)+86400000).toISOString(),source_ref:provider.id+'-question-'+base},'ask-'+base);s=await infra.call('env.snapshot');d=s.snapshot.data;app=d.applications.find(a=>a.id===id);question=d.requests.find(q=>q.application_id===id&&q.application_revision===app.revision&&q.fields.includes('annual_mileage'));}
  if(app.revision!==v.revision||['withdrawn','declined'].includes(app.status))continue;
  const reply=makeReply({virtual_now:s.snapshot.virtual_now},d,app);await event('auto.quote_delivered',reply,'offer-'+base+'-v'+reply.quote_revision);
 }
 return pending.length;
}
module.exports={tick};
