'use strict';
// Maintainer build for the delivery evaluation dataset (2025-01-01 .. 2026-12-31).
// Deterministic: the same seed always writes byte-identical files. Run:
//   node apps/cutroom/scripts/build-history.cjs
// The shipped files are committed; neither tests nor the runtime need this step.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'datasets/history');
const write=(file,x)=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,file),JSON.stringify(x,null,2)+'\n');};
const core=JSON.parse(fs.readFileSync(path.join(root,'fixtures/minimal.json'),'utf8'));
const catalog=JSON.parse(fs.readFileSync(path.join(root,'contribution/assets.catalog.json'),'utf8'));
const CLOCK=JSON.parse(fs.readFileSync(path.join(root,'fixtures/clock.json'),'utf8')).initial_time;
const SEED=239, DATASET_ID='cutroom-history';
let s=SEED; const rnd=()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const pick=a=>a[Math.floor(rnd()*a.length)];
const iso=(y,m,d,h=17,min=0)=>new Date(Date.UTC(y,m-1,d,h,min)).toISOString().replace('.000Z','Z');
const plus=(at,days,h)=>{const d=new Date(at);d.setUTCDate(d.getUTCDate()+days);if(h!==undefined)d.setUTCHours(h,0,0);return d.toISOString().replace('.000Z','Z');};
const before=(a,b)=>Date.parse(a)<Date.parse(b);
// Earliest clock the seed can be loaded at: its latest stored past fact.
const minimumClock=data=>require('../plugin.cjs').pastFacts(data).map(x=>x.at).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1);

// Licensed music signed and expiring across the window. History entries record
// the signing ("active") and any revocation; expiry is inclusive at expires_at.
const historyTracks=[
 ['bgm-h01','Morning desk pads',84,'calm','non_commercial_only','2025-01-08',null,null],
 ['bgm-h02','Pocket groove',104,'upbeat','commercial_sponsored','2025-01-15','2025-12-31',null],
 ['bgm-h03','Glass tones',96,'calm','commercial_sponsored','2025-02-20',null,null],
 ['bgm-h04','Night drive pulse',118,'upbeat','commercial_sponsored','2025-03-12','2025-08-31',null],
 ['bgm-h05','Paper lanterns',78,'calm','non_commercial_only','2025-04-02',null,null],
 ['bgm-h06','Signal bloom',112,'upbeat','commercial_sponsored','2025-05-14',null,'2025-09-18'],
 ['bgm-h07','Workshop shuffle',100,'upbeat','commercial_sponsored','2025-08-27','2026-06-30',null],
 ['bgm-h08','Soft focus',88,'calm','commercial_sponsored','2025-12-03',null,null],
 ['bgm-h09','Bright transit',114,'upbeat','commercial_sponsored','2026-02-11','2026-12-31',null],
 ['bgm-h10','Late edit hum',90,'calm','commercial_sponsored','2026-06-17','2026-12-15',null],
];
const library=[...core.library.map(x=>structuredClone(x)),...historyTracks.map(([id,title,bpm,mood,license_scope,signed,expires,revoked])=>({
 id,title,bpm,mood,license_scope,expires_at:expires?`${expires}T23:59:59Z`:null,kind:'bgm',visual_tags:[],
 history:[{at:`${signed}T16:00:00Z`,status:'active',reason:'License signed with synthetic catalog.'},
  ...(revoked?[{at:`${revoked}T16:00:00Z`,status:'revoked',reason:'Catalog withdrew the track.'}]:[])]}))];
const track=id=>library.find(t=>t.id===id);
const cleared=(t,at,sponsored)=>{
 const signed=t.history.find(h=>h.status==='active');
 const revoked=t.history.find(h=>h.status==='revoked'&&!before(at,h.at));
 return (!signed||!before(at,signed.at))&&!revoked&&(!t.expires_at||!before(t.expires_at,at))&&(!sponsored||t.license_scope==='commercial_sponsored');
};

// Episodes come from the authored plan (titles, descriptions, the moments each
// episode's notes refer to, and planned exceptions). Dates, cut rounds, note
// wording and A/B numbers are drawn from the seeded generator.
const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'history-episodes.json'),'utf8')).episodes;
const DAY=864e5,HOUR=36e5,clockMs=Date.parse(CLOCK),scheduleLimit=Date.parse('2026-12-15T00:00:00Z');
const isoMs=ms=>new Date(Math.round(ms/9e5)*9e5).toISOString().replace('.000Z','Z'); // 15-minute grid
const between=(a,b)=>a+rnd()*(b-a);
const cap=s=>s[0].toUpperCase()+s.slice(1);
const NOTE_TEMPLATES=[
 b=>`Tighten ${b}; it drags after the first beat.`, b=>`Music is louder than dialogue during ${b}.`,
 b=>`${cap(b)}: focus hunts, use the B-cam take.`, b=>`Lower-third over ${b} has a typo.`,
 b=>`Colour shifts between angles in ${b}.`, b=>`Audio drops out for a second in ${b}.`,
 b=>`${cap(b)} needs a caption for the spec numbers.`, b=>`Jump cut in ${b} is jarring; add a cutaway.`,
 b=>`Blur the serial number visible in ${b}.`, b=>`Re-record the VO line over ${b}.`,
 b=>`${cap(b)} is too dark; lift the shadows a touch.`, b=>`Swap the stock b-roll near ${b} for our own footage.`,
 b=>`Check the claim in ${b} against the spec sheet.`, b=>`Room tone changes under ${b}; add a crossfade.`,
 b=>`Move ${b} earlier so the hook lands sooner.`, b=>`Frame is crooked in ${b}; straighten in post.`,
];
const SPONSOR_TEMPLATES=[b=>`Add the paid-promotion disclosure before ${b}.`,b=>`Sponsor asked to re-cut ${b} without the competitor logo.`];
const timecodes=(count,minutes)=>{
 const s=new Set();while(s.size<count)s.add(5+Math.floor(rnd()*(minutes*60-20)));
 return [...s].sort((a,b)=>a-b).map(x=>`${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`);
};
const projects=[];
const coreIds=new Set(core.projects.map(p=>p.id));
for(const e of plan){
 if(e.skip)continue;
 const id=`ep-${e.slot}`,[y,m]=e.slot.slice(0,7).split('-').map(Number),second=e.slot.endsWith('b');
 if(coreIds.has(id))throw new Error('ID clash');
 let kickoff=e.kickoff?Date.parse(e.kickoff):Date.UTC(y,m-1,second?14+Math.floor(rnd()*12):1+Math.floor(rnd()*11),16+Math.floor(rnd()*6),rnd()<.5?0:30);
 let release;
 if(e.release)release=Date.parse(e.release);
 else {
  const d=new Date(kickoff+(6+Math.floor(rnd()*6)+(e.delay||0))*DAY);
  d.setUTCHours(15+Math.floor(rnd()*8),pick([0,0,15,30,45]),0,0);release=d.getTime();
 }
 const past=release<clockMs;
 // Planned work is authored before the clock even when its release is later.
 if(!past&&kickoff>clockMs-3*DAY)kickoff=clockMs-(3+Math.floor(rnd()*6))*DAY;
 const winEnd=Math.min(release-12*HOUR,clockMs-6*HOUR),span=winEnd-kickoff;
 if(span<2*DAY)throw new Error(`Edit window too short for ${id}`);
 const minutes=6+Math.floor(rnd()*11);
 const rounds=1+(rnd()<.75?1:0)+(rnd()<.35?1:0);
 const deck=[...NOTE_TEMPLATES,...(e.sponsored?SPONSOR_TEMPLATES:[])];
 for(let i=deck.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
 const cuts=[];let used=0;
 for(let r=0;r<rounds;r++){
  const start=kickoff+span*r/rounds,end=kickoff+span*(r+1)/rounds,count=2+Math.floor(rnd()*(r===rounds-1?3:2));
  const notes=timecodes(count,minutes).map((timecode,k)=>{
   const at=between(start,start+(end-start)*.55),resolved=between(at+2*HOUR,end);
   return {id:`v${r+1}-n${k+1}`,timecode,text:deck[used++%deck.length](pick(e.beats)),at:isoMs(at),resolved_at:isoMs(Math.min(resolved,end))};
  });
  cuts.push({id:`v${r+1}`,notes,thumbnails:[],keyframes:[],active_thumbnail:null,results:[]});
 }
 const sponsored=!!e.sponsored;
 const usable=library.filter(t=>t.kind==='bgm'&&t.id.startsWith('bgm-h')&&cleared(t,isoMs(release),sponsored));
 const t=e.track?track(e.track):pick(usable.length?usable:[track('bgm-synth-12')]);
 const guest=e.guest?[{id:`guest-${e.slot}`,history:[{at:isoMs(kickoff-between(1,3)*DAY),status:'signed',reason:'Signed at guest intake.'}]}]:[];
 const description=e.description+(e.delay?` Release slipped ${e.delay} days because ${e.delay_reason}.`:'');
 const p={id,title:e.title,description,sponsored,visibility:'private',published_at:null,schedule:null,release_blockers:[],
  track_id:t.id,active_cut:cuts.at(-1).id,cuts,guest_releases:guest,overrides:[]};
 const active=cuts.at(-1);
 if(past&&e.pulled){ // Released, then taken down; the follow-up note is still open.
  active.notes.push({id:`${active.id}-pulled`,timecode:active.notes.at(-1).timecode,
   text:`Pulled after release: re-test the claim in ${e.beats[0]} before re-publishing.`,at:isoMs(release+2*DAY),resolved_at:null});
 } else if(past&&e.unlisted)p.visibility='unlisted';
 else if(past){p.visibility='public';p.published_at=isoMs(release);}
 else if(release<=scheduleLimit)p.schedule={at:isoMs(release),override:false};
 else active.notes[0].resolved_at=null; // Draft still in review at the clock.
 if(e.ab){ // Two candidates tested after release; the winner is the active thumbnail.
  if(!past)throw new Error(`A/B history needs a past release: ${id}`);
  active.thumbnails=['a','b'].map(s=>`${id}-thumb-${s}`);
  const base=.025+rnd()*.045;
  active.results=active.thumbnails.map((asset_id,k)=>({asset_id,ctr:Math.round((base+(k?rnd()*.03-.012:0))*1e4)/1e4,
   retention:Math.round((.35+rnd()*.3)*1e3)/1e3,at:isoMs(release+between(3,8)*DAY)}));
  active.active_thumbnail=active.results.reduce((a,b)=>b.ctr>a.ctr?b:a).asset_id;
 }
 projects.push(p);
}
// Curated history that exercises the approved release semantics on past data.
const byId=id=>projects.find(p=>p.id===id);
{ // Guest withdrew, then re-signed before release (status values: signed / withdrawn).
 const p=byId('ep-2025-06a');p.guest_releases=[{id:'guest-2025-06a',history:[
  {at:'2025-06-02T16:00:00Z',status:'signed',reason:'Signed at guest intake.'},
  {at:'2025-06-08T19:30:00Z',status:'withdrawn',reason:'Guest asked to blur a whiteboard.'},
  {at:'2025-06-11T18:00:00Z',status:'signed',reason:'Re-signed after the blur was added.'}]}];
}
{ // Guest withdrew after release: the release stays public; a current audit shows the blocker.
 const p=byId('ep-2025-10b');p.guest_releases=[{id:'guest-2025-10b',history:[
  {at:'2025-10-17T16:00:00Z',status:'signed',reason:'Signed at guest intake.'},
  {at:'2025-11-03T21:00:00Z',status:'withdrawn',reason:'Guest changed employers and withdrew consent.'}]}];
}
{ // Explicit override with recorded actor, time, intended transition and blockers.
 const p=byId('ep-2025-11a'),c=p.cuts.at(-1);c.notes[0].resolved_at=plus(p.published_at,3,20);
 p.overrides=[{actor:core.owner_person_id,at:p.published_at,reason:'Time-sensitive launch; caption fix shipped after release.',
  intended_transition:{visibility:'public',scheduled_at:null},
  blockers:[{code:'unresolved_note',target_id:c.notes[0].id,message:`${c.notes[0].timecode} ${c.notes[0].text}`}]}];
}
const seed={account_id:core.account_id,owner_person_id:core.owner_person_id,timezone:core.timezone,
 projects:[...projects,...core.projects.map(p=>structuredClone(p))],library};
require('../plugin.cjs').validateSeed({virtual_now:CLOCK,binding:{accounts:[{app_id:'cutroom',account_id:core.account_id,owner_person_id:core.owner_person_id}]}},seed);

// History-only thumbnails (datasets/history/assets/, drawn by render.py) join the package images.
const template=catalog.assets[0];
const historyAssets=projects.flatMap(p=>p.cuts.flatMap(c=>c.thumbnails.map(asset_id=>{
 const file=`datasets/history/assets/${asset_id}.png`,bytes=fs.readFileSync(path.join(root,file));
 const short=plan.find(e=>`ep-${e.slot}`===p.id).short;
 return {...structuredClone(template),asset_id,subjects:[{...template.subjects[0],object_id:p.id}],
  storage:{adapter:'storage.file',path:file,packaging:'bundled'},
  integrity:{bytes:bytes.length,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')},
  provenance:{dataset_id:DATASET_ID,source_ids:['synthetic']},
  presentation:{alt_text:`Thumbnail candidate ${asset_id.slice(-1).toUpperCase()} for "${p.title}": title text "${short}", duration badge`},
  media:{image:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}}};
})));
const historyCatalog={...catalog,catalog_id:'cutroom-history-assets',
 assets:[...catalog.assets.map(a=>({...a,provenance:{...a.provenance,dataset_id:DATASET_ID}})),...historyAssets]};
const counts={planned_slots:plan.length,skipped:plan.filter(e=>e.skip).length,delayed:plan.filter(e=>e.delay).length,
 unlisted:plan.filter(e=>e.unlisted).length,pulled:plan.filter(e=>e.pulled).length,ab_tested:plan.filter(e=>e.ab).length};
const source={source_id:'synthetic',kind:'synthetic',
 description:'Procedurally generated studio history (2025-01..2026-12) from an authored episode plan, plus the authored CutRoom evaluation fixtures. No real people, channels or external records.',
 uri:null,license:'MIT',usage:'permitted',collection:null,
 generation:{method:'procedural',tool:'apps/cutroom/scripts/build-history.cjs',tool_version:'2.0.0',seed:SEED,
  parameters:{window_start:'2025-01-01',window_end:'2026-12-31',timezone:core.timezone,clock:CLOCK,
   plan:'apps/cutroom/scripts/history-episodes.json',images:'apps/cutroom/scripts/render.py',
   cadence:'up to two planned episodes a month on varying days; release 6-11 days after kickoff at varying times, plus authored delays',
   exceptions:counts,
   load_clock:{default_virtual_now:CLOCK,minimum_virtual_now:minimumClock(seed),
    rule:'env.load_seed rejects (invalid_seed) a virtual_now earlier than any stored past fact (published_at, note at/resolved_at, A/B result at, guest and license history, override at). Schedules and license expiries are plans and may point forward.'}}}};
const dataset={schema_version:'pale.dataset.v1',dataset_id:DATASET_ID,version:'2.0.0',
 description:'CutRoom delivery evaluation dataset covering 2025-01-01 through 2026-12-31. Fully synthetic; see evidence/coverage.md.',
 record_source_ids:['synthetic'],sources:[source],transformations:[],
 expected_counts:{records:seed.projects.length,assets:historyCatalog.assets.length},
 quality_policy:{duplicate_records:'reject',duplicate_assets:'reject',missing_assets:'reject'},
 review:{status:'pending',reviewer:null,notes:'Independent human review of realism and provenance pending.'}};
write('seed.json',seed);
write('dataset.json',dataset);
write('assets.catalog.json',historyCatalog);
write('binding.json',{people:[{person_id:core.owner_person_id,name:'Quinn Vale'}],
 accounts:[{app_id:'cutroom',account_id:core.account_id,owner_person_id:core.owner_person_id}],objects:{cutroom:seed.projects.map(p=>p.id)}});
console.log(`wrote ${seed.projects.length} projects, ${library.length} library items and ${historyAssets.length} history images to ${path.relative(process.cwd(),out)}`);

