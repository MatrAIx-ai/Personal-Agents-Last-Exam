'use strict';
// Original synthetic business records, generated through the App's domain transitions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {action}=require('../src/operations.cjs'),{validateSeed}=require('../src/model.cjs');
const root=path.resolve(__dirname,'..'),dest=path.join(root,'evaluation'),seed=1792026;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const themes=[['Quarterly roadmap','Agree delivery priorities and preserve the engineering lead attendance.'],['Customer onboarding','Review the fictional Cedar account handover with support and delivery.'],['Accessibility review','Compare keyboard navigation findings before the release decision.'],['Incident follow-up','Agree owners for recovery actions without sharing customer records.'],['Research synthesis','Discuss conflicting interview findings with design and research.'],['Budget planning','Review internal resourcing assumptions with the project team.'],['Release readiness','Check outstanding verification work and agree the launch review.'],['Partner workshop','Coordinate the fictional Juniper integration workshop across time zones.']];
function build(){
 let rng=seed;
 const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
 const pick=xs=>xs[Math.floor(random()*xs.length)];
 const shuffle=xs=>{const out=[...xs];for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;};
 const partitions=[];
 for(let y=2025;y<=2026;y++)for(let m=0;m<12;m++){
  const month=`${y}-${String(m+1).padStart(2,'0')}`;
  const binding=structuredClone(require('../fixtures/binding.json'));
  const people=binding.people.map(p=>p.person_id),lastDay=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const data={account_id:'poll-maya',owner_person_id:'person-maya',polls:[],notifications:[]};
  // Purposes, actors and lifecycle choices use independent seeded draws, never array position.
  const purposes=shuffle(themes);
  const outcomes=shuffle(['rescheduled','withdrawn','missing',...Array.from({length:5},()=>pick(['draft','confirmed','cancelled','confirmed','awaiting','rescheduled']))]);
  for(let i=0;i<8;i++){
   const day=y===2025&&m===0&&i===0?1:1+Math.floor(random()*14);
   const organizer=pick(people),participants=shuffle(people).slice(0,2+Math.floor(random()*3));
   const outcome=outcomes[i],duration=pick([30,45,60,90]),slotCount=pick([2,3,4]);
   const hour=pick([8,9,13,15,16,17]),zone=pick(['America/Los_Angeles','Europe/London','Asia/Shanghai']);
   const stamp=(offset,h=hour,min=0)=>new Date(Date.UTC(y,m,day+offset,h,min)).toISOString();
   const slots=Array.from({length:slotCount},(_,n)=>{const start=stamp(10+n,pick([8,9,13,15,16,17]),pick([0,15,30]));return {start,end:new Date(Date.parse(start)+duration*60000).toISOString(),timezone:zone};});
   if(m===11&&i===7){slots.at(-1).start=new Date(Date.UTC(y,m,31,16)).toISOString();slots.at(-1).end=new Date(Date.UTC(y,m,31,17)).toISOString();}
   // Build each independent history first, then merge in time order. This avoids a
   // backwards global clock while overlapping polls develop over several days.
   let local={account_id:data.account_id,owner_person_id:data.owner_person_id,polls:[],notifications:[]};
   const ctx={app_id:'meeting-poll',role:'infra',binding,virtual_now:stamp(0)};
   const call=(at,actor,name,args)=>{ctx.virtual_now=at;const out=action(ctx,local,actor,name,args);local=out.data;return out.result;};
   const [purpose,description]=purposes[i];
   const {id}=call(stamp(0,hour,pick([0,10,20,40])),organizer,'create',{title:`${month} ${purpose}`,description,location:pick(['Video room','Project room 1','Project room 2']),participant_ids:participants,deadline:stamp(6,18),slots});
   const selected=pick(local.polls[0].slots).id;
   const votes=(preferred=selected)=>local.polls[0].slots.filter(s=>s.active).map(s=>({slot_id:s.id,value:s.id===preferred?'yes':pick(['yes','if-needed','no'])}));
   if(outcome!=='draft'){
    call(stamp(0,20,pick([0,15,30])),organizer,'publish',{id});
    const respondents=shuffle(participants).slice(0,outcome==='missing'?Math.max(1,participants.length-1):outcome==='awaiting'?Math.floor(random()*participants.length):participants.length);
    const replies=respondents.map(person=>({person,at:stamp(1+Math.floor(random()*4),pick([8,11,14,17,19]),Math.floor(random()*60))})).sort((a,b)=>a.at.localeCompare(b.at));
    for(const r of replies)call(r.at,r.person,'respond',{id,votes:votes()});
    if(outcome==='withdrawn')call(stamp(5,10),respondents[0],'withdraw',{id});
    if(['confirmed','rescheduled'].includes(outcome))call(stamp(5,17),organizer,'finalize',{id,slot_id:selected});
    if(outcome==='cancelled')call(stamp(5,pick([12,16,19])),organizer,'cancel',{id,reason:pick(['Decision deferred: the cost estimate is not ready.','Project owner paused this workstream pending a dependency review.','The handover was completed asynchronously; a meeting is no longer needed.'])});
    if(outcome==='rescheduled'){
     const affected=pick(participants),old=local.polls[0].slots.find(s=>s.id===selected);
     const name=binding.people.find(p=>p.person_id===affected).name;
     const cause=pick(['a customer escalation','a newly assigned on-call shift','a supplier appointment']);
     call(stamp(7,9),organizer,'reopen',{id,deadline:stamp(9,18),reason:`${name} reported ${cause} conflicting with the confirmed ${old.start} slot; request a replacement time.`});
     const start=stamp(Math.min(14,lastDay-day),18);
     call(stamp(7,10),organizer,'edit',{id,patch:{remove_slot_ids:[selected],add_slots:[{start,end:new Date(Date.parse(start)+duration*60000).toISOString(),timezone:zone}]}});
     const replacement=local.polls[0].slots.at(-1).id;
     const updates=shuffle(participants).map((person,j)=>({person,at:stamp(8,8+j*2,Math.floor(random()*60))}));
     for(const r of updates)call(r.at,r.person,'respond',{id,votes:votes(replacement)});
     call(stamp(9,19),organizer,'finalize',{id,slot_id:replacement});
    }
   }
   const poll=local.polls[0];poll.id=`${month}-poll-${i+1}`;
   data.polls.push(poll);
   for(const n of local.notifications){n.poll_id=poll.id;n.id=`${poll.id}-${n.id}`;data.notifications.push(n);}
  }
  data.polls.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
  data.notifications.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  binding.objects['meeting-poll']=data.polls.map(p=>p.id);
  const virtual_now=new Date(Date.UTC(y,m+1,0,23,59,59)).toISOString();
  validateSeed({binding,virtual_now},data);
  partitions.push({month,virtual_now,binding,data});
 }
 return partitions;
}
function records(part){const rows=[];const add=(type,id,at)=>rows.push({type,id,at,provenance:'synthetic'});for(const p of part.data.polls){add('poll',p.id,p.created_at);for(const s of p.slots)add('slot',p.id+'/'+s.id,s.start);for(const type of ['responses','history','meetings'])p[type].forEach((r,i)=>add(type,p.id+'/'+type+'/'+(r.id||i),r.at));}for(const n of part.data.notifications)add('notification',n.id,n.at);return rows;}
function coverage(parts){const rows=parts.flatMap(records),valid=[],excluded=[];for(const r of rows){if(!Number.isFinite(Date.parse(r.at))){excluded.push({...r,reason:'invalid date'});continue;}const date=new Date(r.at).toISOString().slice(0,10);if(date<'2025-01-01'||date>'2026-12-31')excluded.push({...r,reason:'outside window'});else valid.push({...r,date});}
 const dates=[...new Set(valid.map(r=>r.date))].sort(),byType={};for(const type of [...new Set(rows.map(r=>r.type))]){const a=valid.filter(r=>r.type===type);byType[type]={records:a.length,distinct_dates:new Set(a.map(r=>r.date)).size};}
 const days=[];for(let d=Date.parse('2025-01-01');d<=Date.parse('2026-12-31');d+=86400000)days.push(new Date(d).toISOString().slice(0,10));
 return {timezone:'Etc/UTC',window:['2025-01-01','2026-12-31'],total_records:rows.length,included_records:valid.length,distinct_dates:dates.length,earliest:dates[0],latest:dates.at(-1),sources:byType,monthly:parts.map(p=>({month:p.month,polls:p.data.polls.length,records:valid.filter(r=>r.date.startsWith(p.month)).length,distinct_dates:dates.filter(d=>d.startsWith(p.month)).length,real:0,synthetic:valid.filter(r=>r.date.startsWith(p.month)).length})),date_breakdown:dates.map(date=>({date,records:valid.filter(r=>r.date===date).length})),gaps:days.filter(d=>!dates.includes(d)),excluded};}
function main(){const check=process.argv.includes('--check'),parts=build(),files=new Map(parts.map(p=>[p.month+'.json',JSON.stringify(p,null,2)+'\n']));
 const manifest={version:2,seed,provenance:'entirely synthetic; no observed private Doodle records',approved_scope:'452314ca5bc7e73132496362cf7c2ab19b540e11',generator_sha256:hash(fs.readFileSync(__filename)),quality_calculator_sha256:hash(fs.readFileSync(path.join(__dirname,'evaluation-quality.cjs'))),reference_urls:['https://help.doodle.com/en/articles/9457353-how-do-i-create-a-group-poll','https://help.doodle.com/en/articles/9457279-how-do-i-participate-in-a-group-poll'],references_role:'Workflow documentation only; not a source of historical poll records. See evidence reference capture log.',partitions:[...files].map(([file,bytes])=>({file,sha256:hash(bytes),provenance:'synthetic'}))};files.set('manifest.json',JSON.stringify(manifest,null,2)+'\n');
 if(!check)fs.mkdirSync(dest,{recursive:true});for(const [file,bytes]of files){const p=path.join(dest,file);if(check){if(fs.readFileSync(p,'utf8')!==bytes)throw Error('Dataset drift: '+file);}else fs.writeFileSync(p,bytes);}
 // Count bytes read from the delivery, not a separate intended date list.
 const delivered=manifest.partitions.map(p=>JSON.parse(fs.readFileSync(path.join(dest,p.file))));const report=JSON.stringify({...coverage(delivered),dataset_files:manifest.partitions},null,2)+'\n';const qualityReport=JSON.stringify(require('./evaluation-quality.cjs').quality(delivered),null,2)+'\n';const qualityTarget=path.join(dest,'quality.json');if(check){if(fs.readFileSync(qualityTarget,'utf8')!==qualityReport)throw Error('Quality report drift');}else fs.writeFileSync(qualityTarget,qualityReport);const target=path.join(dest,'coverage.json');if(check){if(fs.readFileSync(target,'utf8')!==report)throw Error('Coverage drift');}else fs.writeFileSync(target,report);console.log(JSON.stringify({partitions:parts.length,polls:parts.flatMap(p=>p.data.polls).length,...((({distinct_dates,earliest,latest})=>({distinct_dates,earliest,latest}))(coverage(delivered)))}));
}
module.exports={build,records,coverage,hash};if(require.main===module)main();
