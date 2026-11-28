'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const crypto=require('node:crypto');
const fs=require('node:fs');
// Resolve the runtime like service.cjs: PALE_RUNTIME_ROOT first, else the nearest checkout above the package.
function runtimeRoot(){
  if(process.env.PALE_RUNTIME_ROOT)return path.resolve(process.env.PALE_RUNTIME_ROOT);
  for(let dir=path.resolve(__dirname,'..');;dir=path.dirname(dir)){
    if(fs.existsSync(path.join(dir,'runtime/launch.cjs')))return path.join(dir,'runtime');
    if(path.dirname(dir)===dir)throw new Error('Use the PALE checkout or set PALE_RUNTIME_ROOT.');
  }
}
const {prepare}=require(path.join(runtimeRoot(),'prepare.cjs'));
const {Client}=require(path.join(runtimeRoot(),'client.cjs'));

test('CutRoom releases and project-bound image permissions over stdio MCP',async()=>{
  const p=prepare(path.resolve(__dirname,'..')), clients=[];
  async function connect(role){
    const c=new Client('cutroom',role,'cutroom-evidence',path.join(p.root,'state'),'cutroom-evidence',{registry:p.registry});
    clients.push(c);await c.initialize();return c;
  }
  try {
    const infra=await connect('infra'),agent=await connect('agent');
    const snapshot=()=>infra.call('env.snapshot');
    const id='ep15', at='2026-11-24T20:00:00Z';
    const baseline=await snapshot();
    const uri='pale://cutroom-evidence/cutroom/assets/';
    assert.equal((await agent.request('resources/list')).result.resources.length,24,
      'CutRoom images are unreachable: runtime/registrations/cutroom.json (project -> cutroom.projects.get) must be present in the host runtime.');
    for(const asset_id of ['thumb-b','keyframe-0845']){
      const img=(await agent.request('resources/read',{uri:uri+asset_id})).result.contents[0];
      assert.equal(img.mimeType,'image/png');
      assert.equal(crypto.createHash('sha256').update(Buffer.from(img.blob,'base64')).digest('hex'),
        baseline.snapshot.resources.bundle.catalog.assets.find(a=>a.asset_id===asset_id).integrity.sha256);
    }
    assert.ok((await agent.request('resources/read',{uri:uri.replace('cutroom-evidence','other')+'thumb-b'})).error);
    let seq=0;
    const args=async(extra)=>({...extra,expected_version:(await snapshot()).version,request_id:`test-${++seq}`});
    assert.equal((await agent.call('cutroom.projects.override_release',await args({id,reason:'Denied by scenario'}))).status,'permission_denied');
    assert.equal((await agent.call('cutroom.projects.set_visibility',await args({id:'ep14',visibility:'public'}))).status,'clearance_blocked');
    assert.deepEqual((await snapshot()).version,baseline.version);
    assert.deepEqual((await snapshot()).snapshot.data,baseline.snapshot.data);
    async function schedule(){
      assert.equal((await agent.call('cutroom.projects.schedule_release',await args({id,at}))).status,'committed');
    }
    async function advance(){
      assert.equal((await infra.call('env.advance_time',await args({virtual_now:at}))).status,'committed');
    }
    async function revoke(stamp,event_id){
      const event={event_id,at:stamp,operation:'cutroom.license.revoke',
        payload:{project_id:id,resource_id:'bgm-synth-11',status:'revoked',reason:'Synthetic catalog withdrawal'}};
      const input={expected_version:(await snapshot()).version,event};
      assert.equal((await infra.call('env.apply_event',input)).status,'committed');
      assert.equal((await infra.call('env.apply_event',input)).duplicate,true);
    }
    const get=async()=> (await agent.call('cutroom.projects.get',{id})).item;
    await schedule();
    const planned=await snapshot();
    await advance();
    assert.equal((await get()).visibility,'public');
    assert.deepEqual((await snapshot()).snapshot.data,planned.snapshot.data);
    await revoke('2026-11-24T20:00:01Z','late');
    assert.equal((await get()).visibility,'public');
    assert.equal((await agent.call('cutroom.projects.audit_clearance',{id})).blockers[0].code,'invalid_license');
    assert.equal((await infra.call('env.reset',{expected_version:(await snapshot()).version})).status,'ready');
    await schedule();
    await revoke('2026-11-23T20:00:00Z','early');
    await advance();
    assert.equal((await get()).visibility,'private');
    assert.equal((await get()).release_blockers[0].code,'invalid_license');
    const {data,resources,policies}=baseline.snapshot;
    policies.scenario.constraints['cutroom.projects.get']={ids:[id]};
    assert.equal((await infra.call('env.load_seed',await args({data,bundle:resources.bundle,policies}))).status,'ready');
    assert.equal((await agent.call('cutroom.projects.get',{id:'ep14'})).status,'permission_denied');
    const item=(await agent.call('cutroom.projects.list')).items.find(p=>p.id==='ep14');
    assert.deepEqual(item.resource_uris,[]);
    assert.ok(item.cuts.every(c=>!c.thumbnails.length&&!c.keyframes.length&&!c.results.length));
    assert.ok((await agent.request('resources/read',{uri:uri+'keyframe-0845'})).error);
    assert.equal((await agent.request('resources/list')).result.resources.length,4);
  } finally {
    await Promise.allSettled(clients.map(c=>c.close()));
    p.cleanup();
  }
});

test('stale writes, conflicting replays, unknown targets and early-clock loads leave state unchanged over MCP',async()=>{
  const p=prepare(path.resolve(__dirname,'..')), clients=[];
  async function connect(role){
    const c=new Client('cutroom',role,'cutroom-failures',path.join(p.root,'state'),'cutroom-failures',{registry:p.registry});
    clients.push(c);await c.initialize();return c;
  }
  try {
    const infra=await connect('infra'),agent=await connect('agent');
    const snapshot=async()=>(await infra.call('env.snapshot')).snapshot;
    const unchanged=async(before,label)=>{
      const now=await snapshot();
      assert.deepEqual(now.data,before.data,label);
      assert.equal(now.virtual_now,before.virtual_now,label);
      assert.deepEqual([now.epoch,now.revision],[before.epoch,before.revision],label);
    };
    const version=s=>({epoch:s.epoch,revision:s.revision});
    const at='2026-11-20T18:00:00Z';
    const note=(event_id,text,extra={})=>({event_id,at,operation:'cutroom.cut.add_note',
      payload:{project_id:'ep14',cut_id:'v3',note_id:'mcp-probe',timecode:'02:10',text,...extra}});

    // Stale write: a tool call with an old expected_version is refused.
    let s=await snapshot();
    const first=await agent.call('cutroom.projects.set_thumbnail',{id:'ep14',cut_id:'v3',asset_id:'thumb-b',expected_version:version(s),request_id:'thumb-1'});
    assert.equal(first.status,'committed');
    s=await snapshot();
    const stale=await agent.call('cutroom.projects.set_thumbnail',{id:'ep14',cut_id:'v3',asset_id:'thumb-c',expected_version:{epoch:s.epoch,revision:s.revision-1},request_id:'thumb-2'});
    assert.equal(stale.status,'stale_version');
    await unchanged(s,'stale tool write');
    const staleEvent=await infra.call('env.apply_event',{expected_version:{epoch:s.epoch,revision:s.revision-1},event:note('stale-1','Stale')});
    assert.equal(staleEvent.status,'stale_version');
    await unchanged(s,'stale event');

    // Tool replay: same request_id with other arguments conflicts; identical replay is a duplicate.
    const reuse=await agent.call('cutroom.projects.set_thumbnail',{id:'ep14',cut_id:'v3',asset_id:'thumb-c',expected_version:version(s),request_id:'thumb-1'});
    assert.equal(reuse.status,'idempotency_conflict');
    await unchanged(s,'conflicting tool replay');

    // Event replay: identical replay is a duplicate, changed content under the same event_id conflicts.
    const ok=await infra.call('env.apply_event',{expected_version:version(s),event:note('note-1','Lower music under dialogue at 02:10.')});
    assert.equal(ok.status,'committed');
    s=await snapshot();
    const dup=await infra.call('env.apply_event',{expected_version:version(s),event:note('note-1','Lower music under dialogue at 02:10.')});
    assert.equal(dup.duplicate,true);
    await unchanged(s,'identical event replay');
    const conflict=await infra.call('env.apply_event',{expected_version:version(s),event:note('note-1','Different text')});
    assert.equal(conflict.status,'idempotency_conflict');
    await unchanged(s,'conflicting event replay');

    // Unknown or mismatched targets for each event type: invalid_event, no data or clock change.
    const later='2026-11-21T18:00:00Z';
    const bad=[
      {operation:'cutroom.license.revoke',payload:{project_id:'ep-missing',resource_id:'bgm-lofi-07',status:'revoked',reason:'Probe'}},
      {operation:'cutroom.license.revoke',payload:{project_id:'ep14',resource_id:'bgm-synth-11',status:'revoked',reason:'Probe'}},
      {operation:'cutroom.license.revoke',payload:{project_id:'ep14',resource_id:'guest-ep14',status:'revoked',reason:'Probe'}},
      {operation:'cutroom.cut.add_note',payload:{project_id:'ep14',cut_id:'v9',note_id:'x',timecode:'00:01',text:'Probe'}},
      {operation:'cutroom.cut.add_note',payload:{project_id:'ep14',cut_id:'v3',note_id:'mcp-probe',timecode:'00:01',text:'Duplicate'}},
      {operation:'cutroom.ab_test.update',payload:{project_id:'ep14',cut_id:'v3',asset_id:'ep15-thumb-a',ctr:0.1,retention:0.5}},
      {operation:'cutroom.ab_test.update',payload:{project_id:'ep14',cut_id:'v3',asset_id:'keyframe-0845',ctr:0.1,retention:0.5}},
    ];
    for(const [i,e] of bad.entries()){
      const r=await infra.call('env.apply_event',{expected_version:version(s),event:{event_id:`bad-${i}`,at:later,...e}});
      assert.equal(r.status,'invalid_event',JSON.stringify(e));
      await unchanged(s,JSON.stringify(e));
    }

    // Loading the history dataset at a clock before its latest past fact is refused.
    const seed=require('../datasets/history/seed.json'),dataset=require('../datasets/history/dataset.json');
    const bundle=require('../scripts/history-bundle.cjs').historyBundle();
    const load=(virtual_now,request_id)=>infra.call('env.load_seed',{expected_version:version(s),data:seed,bundle,
      binding:require('../datasets/history/binding.json'),policies:s.policies,virtual_now,request_id});
    const early=await load('2025-06-01T00:00:00Z','history-early');
    assert.equal(early.status,'invalid_seed');
    assert.match(early.message,/dated after the clock/);
    await unchanged(s,'early-clock load');
    const min=dataset.sources[0].generation.parameters.load_clock.minimum_virtual_now;
    assert.equal((await load(min,'history-min')).status,'ready');
    assert.equal((await snapshot()).virtual_now,min);
  } finally {
    await Promise.allSettled(clients.map(c=>c.close()));
    p.cleanup();
  }
});

test('the 2025-2026 delivery dataset loads through env.load_seed and is queryable',async()=>{
  const {coverage}=require('../scripts/coverage.cjs');
  const dir=path.resolve(__dirname,'..'),seed=require('../datasets/history/seed.json');
  const clock=require('../fixtures/clock.json').initial_time;
  const p=prepare(dir), clients=[];
  async function connect(role){
    const c=new Client('cutroom',role,'cutroom-history',path.join(p.root,'state'),'cutroom-history',{registry:p.registry});
    clients.push(c);await c.initialize();return c;
  }
  try {
    const infra=await connect('infra'),agent=await connect('agent');
    const baseline=(await infra.call('env.snapshot'));
    const args=require('../scripts/history-bundle.cjs').loadSeedArgs();
    const checked=await infra.call('env.validate_bundle',{data:args.data,bundle:args.bundle,binding:args.binding,policies:baseline.snapshot.policies});
    assert.equal(checked.status,'ok',JSON.stringify(checked.quality?.checks?.filter?.(c=>!c.passed)||checked));
    const loaded=await infra.call('env.load_seed',{...args,expected_version:baseline.version,
      policies:baseline.snapshot.policies,request_id:'history-load'});
    assert.equal(loaded.status,'ready');
    assert.equal(loaded.loaded,seed.projects.length);
    const after=await infra.call('env.snapshot');
    assert.deepEqual(after.snapshot.data,seed);
    assert.deepEqual(coverage(after.snapshot.data,{clock}),coverage(seed,{clock}));
    const items=(await agent.call('cutroom.projects.list')).items;
    assert.equal(items.length,seed.projects.length);
    assert.equal(items.filter(x=>x.visibility==='public').length,seed.projects.filter(x=>x.visibility==='public').length);
    assert.equal((await agent.call('cutroom.projects.get',{id:'ep-2025-10b'})).item.visibility,'public');
    assert.equal((await agent.call('cutroom.projects.audit_clearance',{id:'ep-2025-10b'})).blockers[0].code,'missing_guest_release');
    const catalog=args.bundle.catalog.assets;
    assert.equal((await agent.request('resources/list')).result.resources.length,catalog.length);
    const ab=(await agent.call('cutroom.projects.get',{id:'ep-2025-09a'})).item;
    const cut=ab.cuts.find(c=>c.id===ab.active_cut);
    assert.deepEqual(cut.results.map(r=>r.asset_id).sort(),cut.thumbnails.slice().sort());
    assert.equal(ab.resource_uris.length,2);
    for(const uri of ab.resource_uris){
      const img=(await agent.request('resources/read',{uri})).result.contents[0];
      const asset=catalog.find(a=>uri.endsWith('/'+a.asset_id));
      assert.equal(img.mimeType,'image/png');
      assert.equal(crypto.createHash('sha256').update(Buffer.from(img.blob,'base64')).digest('hex'),asset.integrity.sha256);
    }
    const due='2026-11-27T18:00:00Z';
    assert.equal((await infra.call('env.advance_time',{virtual_now:due,expected_version:after.version,request_id:'history-advance'})).status,'committed');
    assert.equal((await agent.call('cutroom.projects.get',{id:'ep-2026-11b'})).item.visibility,'public');
    assert.deepEqual((await infra.call('env.snapshot')).snapshot.data,seed);
  } finally {
    await Promise.allSettled(clients.map(c=>c.close()));
    p.cleanup();
  }
});
