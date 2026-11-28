'use strict';
// Maintainer build only. Published App and its business tests need no build step.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),repo=path.resolve(root,'../..');
const write=(file,x)=>{const f=path.join(root,file);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(x,null,2)+'\n');};
const read=file=>JSON.parse(fs.readFileSync(path.join(repo,file),'utf8'));
const app='cutroom', account='cutroom-studio', owner='person-editor';
const clock='2026-11-19T18:00:00Z';
const date={type:'string',format:'date-time'}, id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const text=(maxLength=200)=>({type:'string',minLength:1,maxLength});
const bool={type:'boolean'}, ratio={type:'number',minimum:0,maximum:1};
const en=(...values)=>({enum:values}), nullable=x=>({anyOf:[x,{type:'null'}]});
const arr=items=>({type:'array',items}), obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const timecode={type:'string',pattern:'^[0-9]{2}:[0-5][0-9]$'};
const noteInput={note_id:id,timecode,text:text(2000)};
const note=obj({id,timecode,text:noteInput.text,at:date,resolved_at:nullable(date)});
const result=obj({asset_id:id,ctr:ratio,retention:ratio,at:date});
const cut=obj({id,notes:arr(note),thumbnails:arr(id),keyframes:arr(id),active_thumbnail:nullable(id),results:arr(result)});
const vis=en('private','unlisted','public');
const blocker=obj({code:en('unresolved_note','invalid_license','missing_guest_release'),target_id:id,message:text(2200)});
const blockers=arr(blocker);
const history=status=>arr(obj({at:date,status,reason:text(1000)}));
const track=obj({id,title:text(),kind:en('bgm','b_roll','transcript'),mood:text(),bpm:nullable({type:'integer',minimum:1}),license_scope:en('commercial_sponsored','non_commercial_only'),expires_at:nullable(date),visual_tags:arr(text()),history:history(en('active','revoked'))});
const projectFields={id,title:text(),description:{type:'string',maxLength:2000},sponsored:bool,visibility:vis,published_at:nullable(date),
  schedule:nullable(obj({at:date,override:bool})), release_blockers:blockers,track_id:id,active_cut:id,cuts:arr(cut),
  guest_releases:arr(obj({id,history:history(en('signed','withdrawn'))})),
  overrides:arr(obj({actor:id,at:date,reason:text(1000),intended_transition:obj({visibility:vis,scheduled_at:nullable(date)}),blockers}))};
const view=obj({...projectFields,asset_ids:arr(id),resource_uris:arr(text(320))});
const ver=obj({epoch:{type:'integer',minimum:1},revision:{type:'integer',minimum:0}});
const tools=[];
function tool(op,description,read_only,p,r,out) {
  const name=`${app}.${op}`;
  tools.push({name,description,read_only,scope:name,resource_target:'current studio',inputSchema:obj(
    read_only?p:{...p,expected_version:ver,request_id:id},read_only?r:[...r,'expected_version','request_id']),
    outputSchema:obj({status:{const:read_only?'ok':'committed'},app_id:{const:app},version:ver,...out})});
}
const item={item:view}, withId={id}, cutId={id,cut_id:id};
tool('projects.list','List projects and effective release state.',true,{},[],{items:arr(view)});
tool('projects.get','Read one project, its cuts, and authorized image references.',true,withId,['id'],item);
tool('cuts.list_notes','Read timestamped notes for one cut.',true,cutId,['id','cut_id'],{items:arr(note)});
tool('library.search','Filter library by kind, title, mood, visual tags, inclusive BPM, scope, and active license.',true,
  {kind:track.properties.kind,query:text(),mood:text(),max_bpm:{type:'integer',minimum:1},license_scope:track.properties.license_scope,active:bool,visual_tags:arr(text())},[],{items:arr(track)});
tool('projects.audit_clearance','Report outstanding notes, music and guest release blockers at the current virtual time.',true,withId,['id'],{cleared:bool,blockers});
tool('cuts.add_note','Add a timestamped review note.',false,{...cutId,...noteInput},['id','cut_id','note_id','timecode','text'],item);
tool('cuts.resolve_note','Resolve a note without changing its original resolution time on repeat.',false,{...cutId,note_id:id},['id','cut_id','note_id'],item);
tool('projects.update_metadata','Edit project title and description.',false,{id,patch:obj({title:projectFields.title,description:projectFields.description},[])},['id','patch'],item);
tool('projects.set_thumbnail','Select a thumbnail belonging to the requested cut.',false,{...cutId,asset_id:id},['id','cut_id','asset_id'],item);
tool('projects.assign_track','Assign cleared BGM to one project.',false,{id,track_id:id},['id','track_id'],item);
tool('projects.set_visibility','Set visibility; a public release requires clearance.',false,{id,visibility:vis},['id','visibility'],item);
tool('projects.schedule_release','Schedule a future release subject to a clearance check.',false,{id,at:date},['id','at'],item);
tool('projects.override_release','Explicitly override clearance for a simulated public release; records reasons and current blockers.',false,
  {id,at:date,reason:text(1000)},['id','reason'],item);
const events={
 'cutroom.cut.add_note':obj({project_id:id,cut_id:id,...noteInput}),
 'cutroom.license.revoke':obj({project_id:id,resource_id:id,status:en('revoked','withdrawn','signed'),reason:text(1000)}),
 'cutroom.ab_test.update':obj({project_id:id,cut_id:id,asset_id:id,ctr:ratio,retention:ratio})
};
const schemaPaths={seed:'schemas/seed.schema.json',state:'schemas/state.schema.json',events:'schemas/events.schema.json'};
const fixtures={seed:'fixtures/minimal.json',binding:'fixtures/binding.json',policies:'fixtures/policies.json'};
write('app.json',{schema_version:1,app_id:app,version:'1.0.0',core_api_version:'1.2.0',maintainer:{contact:'@Aria068 (PR #239)'},license:'MIT',
 entrypoint:'plugin.cjs',service:'service.cjs',tools:'tools.json',schemas:schemaPaths,fixtures,dependencies:[],event_types:Object.keys(events),
 capabilities:{modes:['synthetic'],resources:true,ui:'none',real_delivery:false},limitations:['Simulated release only; no video encoding, streaming, GUI or external delivery.'],
 dataset:'contribution/dataset.json',resources:{catalog:'contribution/assets.catalog.json',directory:'assets'},contribution:'contribution/contribution.json'});
write('tools.json',tools);
write(schemaPaths.seed,obj({account_id:id,owner_person_id:id,timezone:text(64),projects:arr(obj(projectFields)),library:arr(track)}));
// Templates are copied into the package (scripts/templates/) so it rebuilds on its own.
const template=file=>JSON.parse(fs.readFileSync(path.join(root,'scripts/templates',file),'utf8'));
const state=template('state.schema.json');state.properties.app_id.const=app;write(schemaPaths.state,state);
write(schemaPaths.events,{oneOf:Object.entries(events).map(([op,payload])=>obj({event_id:id,at:date,operation:{const:op},payload}))});
for(const name of ['resources','bundle','asset-catalog','asset-descriptor','dataset','quality']){
 const file=`schemas/${name}.schema.json`;
 fs.copyFileSync(path.join(repo,'runtime/contracts',file),path.join(root,file));
}
const c=template('contribution.template.json');
Object.assign(c,{app_id:app,gui_ref:null,events:{...c.events,accepts:Object.keys(events).map(type=>({type,schema_ref:schemaPaths.events,status:'implemented'}))}});
c.extensions=[{namespace:'cutroom.evaluation_dataset',version:'1',required:false,data:{
 description:'Delivery evaluation dataset, 2025-01-01 to 2026-12-31, fully synthetic. fixtures/minimal.json stays the default smoke seed.',
 seed:'datasets/history/seed.json',dataset:'datasets/history/dataset.json',catalog:'datasets/history/assets.catalog.json',
 binding:'datasets/history/binding.json',load_seed_arguments:'scripts/history-bundle.cjs#loadSeedArgs',
 default_virtual_now:clock,coverage_report:'evidence/coverage.md'}}];
c.asset_runtime.implemented_mime_types=['image/png'];c.asset_runtime.implemented_storage_adapters=['storage.file'];
c.interfaces[0].operations=tools.map(t=>({name:t.name,effect:t.read_only?'read':'write',caller:'agent'}));
write('contribution/contribution.json',c);
const tracks=[
 ['bgm-lofi-07','Lo-fi desk loop',92,'calm','non_commercial_only',null],
 ['bgm-synth-11','Upbeat synth',110,'upbeat','commercial_sponsored','2026-11-25T00:00:00Z'],
 ['bgm-synth-12','Bright synth',102,'upbeat','commercial_sponsored',null],
 ['bgm-fast','Fast synth',115,'upbeat','commercial_sponsored',null],
 ['bgm-expired','Expired synth',108,'upbeat','commercial_sponsored','2026-10-31T00:00:00Z'],
];
const library=tracks.map(([id,title,bpm,mood,license_scope,expires_at])=>({id,title,bpm,mood,license_scope,expires_at,kind:'bgm',visual_tags:[],history:[]}));
const topics=['Desk setup','City commute','Color workflow','Studio lighting','Battery test','Sound check','Field edit','Travel rig','Cable kit','Camera rig','Notebook','Export review'];
for (let i=0;i<topics.length;i++) for(const kind of ['b_roll','transcript']){
 const title=topics[i];
 library.push({id:`${kind}-${i+1}`,title:`${title} ${kind==='b_roll'?'wide shot':'interview transcript'}`,kind,
   mood:i%2?'calm':'upbeat',bpm:null,license_scope:'commercial_sponsored',expires_at:null,visual_tags:[i%2?'interior':'exterior',title.toLowerCase()],history:[]});
}
const titles=['Laptop battery-life review','Color grading walkthrough','Packing a field kit','Studio lighting on a budget','Desktop audio setup','A week of commute edits'];
const makeNote=(id,timecode,text,at,resolved_at=null)=>({id,timecode,text,at,resolved_at});
// Resolved notes for ep15..ep19; the keyframe of each project shows the moment of the first one.
const topicNotes=[
 [['skin','03:20','Skin tones go green on the B-cam shot after the LUT.'],['open','00:12','Cold open lingers on the ungraded clip; cut to the reveal sooner.'],['vo','05:48','Voice-over is quieter than the screen recording audio.']],
 [['overhead','01:48','Packing overhead is soft; the tripod leg locks are out of focus.'],['weight','04:05','Weight graphic says 6.8 kg but the scale shot reads 7.2 kg.'],['endcard','09:30','End card links to last year\'s kit video.']],
 [['glasses','05:02','Softbox reflection shows in the presenter\'s glasses; tilt the key light.'],['price','02:15','Clamp light price lower-third is missing the currency.'],['flicker','07:40','LED flicker visible at 1/100 shutter in the second demo.']],
 [['meter','02:41','Level meter graphic hits red at the peak; redraw it at -6 dBFS.'],['hum','04:58','Ground-loop hum under the interface demo.'],['arm','08:12','Boom arm creak is audible when it swings into frame.']],
 [['glare','06:17','Window glare hides the timeline on the laptop screen; use the other take.'],['shake','01:30','Handheld shake on the platform shot; stabilise or replace it.'],['wifi','10:05','The train Wi-Fi speed claim needs an on-screen source.']],
];
const altTitles=['14 HOURS','GRADE IN 10 MIN','PACK LIGHT','$50 STUDIO LIGHT','DESK AUDIO FIX','EDIT ON A TRAIN'];
const keyframeAlt=['Frame at 08:45: laptop on a desk with an email inbox open on screen',
 'Frame at 03:20: presenter on the B-camera in front of a grey backdrop',
 'Frame at 01:48: overhead flat-lay of a backpack, camera, folded tripod and batteries',
 'Frame at 05:02: presenter in glasses with a softbox in the background',
 'Frame at 02:41: boom microphone and headphones on a desk with an on-screen level meter',
 'Frame at 06:17: train window and a laptop on the table'];
const sceneAlt=['laptop with a battery meter on a desk','colour wheels beside a split-screen monitor','backpack, camera and tripod',
 'softbox lighting a presenter','boom microphone, headphones and waveform monitor','train window with a laptop on the table'];
const descriptions=['Sponsored review of a 14-hour ultrabook: battery rundown, screen recording of the benchmark, and a guest segment.',
 'Sponsored walkthrough grading A-cam and B-cam footage to match in ten minutes with a LUT and scopes.',
 'Sponsored packing guide for a one-day field shoot: bag, camera, tripod and power, weighed on camera.',
 'Sponsored budget lighting build: one softbox, a clamp light and practicals for under $50.',
 'Sponsored desk audio fix: boom arm, interface gain staging and killing a ground-loop hum.',
 'Sponsored week of editing on the commuter train: laptop, power and working around window glare.'];
const order=(a,b)=>a.timecode<b.timecode?-1:a.timecode>b.timecode?1:0;
const projects=titles.map((title,i)=>{
 const id=`ep${14+i}`,at=`2026-${String(i+3).padStart(2,'0')}-13T18:00:00Z`;
 const thumbnails=i===0?['thumb-a','thumb-b','thumb-c']:['a','b','c'].map(s=>`${id}-thumb-${s}`);
 const keyframes=[i===0?'keyframe-0845':`${id}-keyframe`];
 const notes=i===0?[makeNote('benchmark','04:12','Wrong benchmark graphic.',at),makeNote('screen','08:45','Review the screen content.',at),
   makeNote('intro','00:11','Tighten the intro.',at,at)]:
   topicNotes[i-1].map(([id,tc,t])=>makeNote(id,tc,t,at,at)).sort(order);
 const active_cut=i===0?'v3':'v1';
 const cuts=[{id:active_cut,notes,thumbnails,keyframes,active_thumbnail:null,
   results:[{asset_id:thumbnails[0],ctr:.035+i*.003,retention:.47+i*.02,at}]}];
 if(i===0) cuts.unshift({id:'v2',notes:[],thumbnails:[],keyframes:[],active_thumbnail:null,results:[]});
 return {id,title,description:descriptions[i],sponsored:true,visibility:'private',published_at:null,schedule:null,
   release_blockers:[],track_id:i===0?'bgm-lofi-07':i===1?'bgm-synth-11':'bgm-synth-12',
   active_cut,cuts,guest_releases:i===0?[{id:'guest-ep14',history:[{at,status:'signed',reason:'Signed in studio intake.'}]}]:[],overrides:[]};
});
const assets=projects.flatMap(p=>p.cuts.flatMap(c=>[...c.thumbnails,...c.keyframes].map(asset_id=>{
 const file=`assets/${asset_id}.png`, bytes=fs.readFileSync(path.join(root,file));
 return {schema_version:'pale.asset-descriptor.v1',asset_id,scope:{level:'package',app_id:app},roles:['content.inline'],
  subjects:[{app_id:app,account_id:account,object_type:'project',object_id:p.id}],mime_type:'image/png',
  availability:{status:'ready'},storage:{adapter:'storage.file',path:file,packaging:'bundled'},
  integrity:{bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},
  provenance:{dataset_id:'cutroom-synthetic',source_ids:['synthetic']},publication:'public',
  access:{audience:['agent'],rule:'parent_object'},presentation:{alt_text:c.thumbnails.includes(asset_id)
   ?`Thumbnail candidate ${asset_id.slice(-1).toUpperCase()} for "${p.title}": ${sceneAlt[projects.indexOf(p)]}, title text "${altTitles[projects.indexOf(p)]}", duration badge`
   :`Review keyframe from "${p.title}". ${keyframeAlt[projects.indexOf(p)]}, burned-in review timecode`},
  media:{image:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}},extensions:[]};
})));
require('node:assert/strict').ok(assets.length===24&&assets.reduce((a,x)=>a+x.integrity.bytes,0)<=520*1024);
const source={source_id:'synthetic',kind:'synthetic',description:'Authored studio records and original procedural artwork.',uri:null,license:'MIT',
 usage:'permitted',collection:null,generation:{method:'procedural',tool:'CutRoom fixture scripts',tool_version:'1.0.0',seed:null,parameters:{}}};
write('contribution/assets.catalog.json',{schema_version:'pale.asset-catalog.v1',catalog_id:'cutroom-assets',app_id:app,dataset_ref:'dataset.json',assets,extensions:[]});
write('contribution/dataset.json',{schema_version:'pale.dataset.v1',dataset_id:'cutroom-synthetic',version:'1.0.0',
 description:'Fictional studio workflow fixtures. No external sources.',record_source_ids:['synthetic'],sources:[source],transformations:[],
 expected_counts:{records:projects.length,assets:assets.length},quality_policy:{duplicate_records:'reject',duplicate_assets:'reject',missing_assets:'reject'},
 review:{status:'pending',reviewer:null,notes:'Independent human visual and provenance review pending.'}});
write(fixtures.seed,{account_id:account,owner_person_id:owner,timezone:'America/Los_Angeles',projects,library});
write(fixtures.binding,{people:[{person_id:owner,name:'Quinn Vale'}],accounts:[{app_id:app,account_id:account,owner_person_id:owner}],objects:{[app]:projects.map(p=>p.id)}});
const allow=tools.map(t=>t.name);
write(fixtures.policies,{scenario:{allow:allow.filter(n=>!n.endsWith('.override_release')),constraints:{}},sandbox:{allow,constraints:{}}});
write('fixtures/clock.json',{initial_time:clock});
write('tests/cases.json',{read:{name:'cutroom.projects.get',args:{id:'ep14'}}});
write('examples/scenario.json',{event_id:'guest-withdrawal',at:'2026-11-20T19:00:00Z',operation:'cutroom.license.revoke',
 payload:{project_id:'ep14',resource_id:'guest-ep14',status:'withdrawn',reason:'Guest requested a face blur.'}});
