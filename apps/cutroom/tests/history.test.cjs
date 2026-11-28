'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const app=require('../plugin.cjs');
const {coverage}=require('../scripts/coverage.cjs');
const root=path.resolve(__dirname,'..');
const seed=require('../datasets/history/seed.json');
const binding=require('../datasets/history/binding.json');
const clock=require('../fixtures/clock.json').initial_time;
const call=(at,op,args={})=>app.handleTool({virtual_now:at,binding,run_id:'history'},structuredClone(seed),'cutroom.'+op,args).result;
const project=(at,id)=>call(at,'projects.get',{id}).item;

test('delivery dataset is a valid seed that covers every month of 2025-2026',()=>{
  app.validateSeed({virtual_now:clock,binding},seed);
  const r=coverage(seed,{clock});
  assert.deepEqual(r.window,['2025-01-01','2026-12-31']);
  assert.equal(r.outside_window,0);assert.equal(r.invalid,0);
  assert.deepEqual(r.months_without_records,[]);
  assert.equal(r.earliest.slice(0,7),'2025-01');assert.equal(r.latest.slice(0,7),'2026-12');
  assert.ok(r.distinct_dates>=300,`distinct dates ${r.distinct_dates}`);
  const dataset=require('../datasets/history/dataset.json');
  assert.equal(dataset.expected_counts.records,seed.projects.length);
  assert.ok(dataset.sources.every(s=>s.kind==='synthetic'&&s.generation.seed===239));
});

test('committed coverage report matches the committed seed',()=>{
  const report=JSON.parse(fs.readFileSync(path.join(root,'evidence/coverage.json'),'utf8'));
  const sha=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'datasets/history/seed.json'))).digest('hex');
  assert.equal(report.sha256,sha);
  const {input,sha256,...rest}=report;
  assert.deepEqual(rest,JSON.parse(JSON.stringify(coverage(seed,{clock}))));
});

test('no stored past fact is dated after the clock; only schedules and expiries point forward',()=>{
  const {events}=require('../scripts/coverage.cjs');
  const late=events(seed).filter(e=>Date.parse(e.at)>Date.parse(clock));
  assert.ok(late.length>0);
  assert.deepEqual([...new Set(late.map(e=>e.field))].sort(),['expires_at','schedule.at']);
});

test('the history dataset cannot be loaded at a clock earlier than its minimum',()=>{
  const rule=require('../datasets/history/dataset.json').sources[0].generation.parameters.load_clock;
  const latest=app.pastFacts(seed).map(x=>x.at).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1);
  assert.equal(rule.minimum_virtual_now,latest);
  assert.equal(rule.default_virtual_now,clock);
  assert.ok(Date.parse(latest)<=Date.parse(clock));
  const second=new Date(Date.parse(latest)-1000).toISOString().replace('.000Z','Z');
  for(const early of ['2025-06-01T00:00:00Z',second])
    assert.throws(()=>app.validateSeed({virtual_now:early,binding},seed),{code:'invalid_seed',message:/dated after the clock/});
  app.validateSeed({virtual_now:latest,binding},seed);
  app.validateSeed({virtual_now:clock,binding},seed);
  app.validateSeed({virtual_now:'2026-12-31T23:59:59Z',binding},seed);
});

test('every historical release was cleared at its own release time unless it carries an override',()=>{
  for(const p of seed.projects.filter(p=>p.published_at)){
    const check=call(p.published_at,'projects.audit_clearance',{id:p.id});
    if(p.overrides.length){
      assert.equal(check.cleared,false);
      const o=p.overrides[0];
      assert.equal(o.actor,seed.owner_person_id);assert.equal(o.at,p.published_at);
      assert.deepEqual(o.intended_transition,{visibility:'public',scheduled_at:null});
      assert.deepEqual(o.blockers,check.blockers);
    } else assert.equal(check.cleared,true,p.id);
  }
});

test('later revocations and withdrawals leave past releases public but add audit blockers',()=>{
  const music=project(clock,'ep-2025-08b');
  assert.equal(music.visibility,'public');
  assert.deepEqual(call(clock,'projects.audit_clearance',{id:'ep-2025-08b'}).blockers.map(b=>b.code),['invalid_license']);
  const guest=project(clock,'ep-2025-10b');
  assert.equal(guest.visibility,'public');
  assert.deepEqual(call(clock,'projects.audit_clearance',{id:'ep-2025-10b'}).blockers.map(b=>b.code),['missing_guest_release']);
  // Withdrawn then re-signed before release: cleared at release.
  const resign=seed.projects.find(p=>p.id==='ep-2025-06a');
  assert.deepEqual(resign.guest_releases[0].history.map(h=>h.status),['signed','withdrawn','signed']);
  assert.equal(call(resign.published_at,'projects.audit_clearance',{id:resign.id}).cleared,true);
  assert.equal(call('2025-06-09T00:00:00Z','projects.audit_clearance',{id:resign.id}).blockers.at(-1).code,'missing_guest_release');
});

test('planned releases become public on read at their instant without a write',()=>{
  for(const p of seed.projects.filter(p=>p.schedule)){
    assert.equal(project(clock,p.id).visibility,'private');
    const out=app.handleTool({virtual_now:p.schedule.at,binding,run_id:'history'},structuredClone(seed),'cutroom.projects.get',{id:p.id});
    assert.equal(out.result.item.visibility,'public');
    assert.equal(out.result.item.published_at,p.schedule.at);
    assert.deepEqual(out.data,seed);
  }
  assert.ok(seed.projects.some(p=>p.schedule&&p.schedule.at.startsWith('2026-12')));
});

test('history is varied: note texts, descriptions, cadence and planned exceptions',()=>{
  const notes=seed.projects.flatMap(p=>p.cuts.flatMap(c=>c.notes));
  assert.ok(notes.length>=250,`notes ${notes.length}`);
  assert.equal(new Set(notes.map(n=>n.text)).size,notes.length,'every note text is distinct');
  assert.equal(new Set(seed.projects.map(p=>p.description)).size,seed.projects.length);
  const released=seed.projects.filter(p=>p.published_at).map(p=>p.published_at);
  assert.ok(new Set(released.map(r=>r.slice(8,10))).size>=15,'releases fall on many days of the month');
  assert.ok(new Set(released.map(r=>r.slice(11,16))).size>=10,'releases happen at many times of day');
  assert.ok(new Set(notes.map(n=>n.at.slice(8,10))).size>=25,'notes are written on most days of the month');
  const plan=require('../scripts/history-episodes.json').episodes;
  const ids=new Set(seed.projects.map(p=>p.id));
  for(const e of plan.filter(e=>e.skip))assert.ok(!ids.has(`ep-${e.slot}`),`skipped ${e.slot}`);
  const byId=id=>seed.projects.find(p=>p.id===id);
  for(const e of plan.filter(e=>e.unlisted))assert.equal(byId(`ep-${e.slot}`).visibility,'unlisted');
  for(const e of plan.filter(e=>e.pulled)){
    const p=byId(`ep-${e.slot}`);
    assert.equal(p.visibility,'private');assert.equal(p.published_at,null);
    assert.ok(p.cuts.at(-1).notes.some(n=>n.resolved_at===null&&/^Pulled after release/.test(n.text)));
  }
  for(const e of plan.filter(e=>e.delay))assert.match(byId(`ep-${e.slot}`).description,new RegExp(`slipped ${e.delay} days`));
});

test('A/B history spans the window on real thumbnails, and the winner is the active thumbnail',()=>{
  const catalog=require('../datasets/history/assets.catalog.json').assets;
  const rows=seed.projects.filter(p=>p.id.startsWith('ep-')).flatMap(p=>p.cuts.flatMap(c=>c.results.map(r=>({p,c,r}))));
  const months=new Set(rows.map(x=>x.r.at.slice(0,7)));
  assert.ok(rows.length>=20,`rows ${rows.length}`);
  assert.ok([...months].some(m=>m<'2025-07')&&[...months].some(m=>m>'2026-08'),[...months].join(','));
  for(const {p,c,r} of rows){
    assert.ok(c.thumbnails.includes(r.asset_id));
    assert.ok(Date.parse(r.at)>Date.parse(p.published_at)&&Date.parse(r.at)<=Date.parse(clock));
    const best=c.results.reduce((a,b)=>b.ctr>a.ctr?b:a);
    assert.equal(c.active_thumbnail,best.asset_id);
    const asset=catalog.find(a=>a.asset_id===r.asset_id);
    const bytes=fs.readFileSync(path.join(root,asset.storage.path));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.integrity.sha256);
    assert.equal(asset.subjects[0].object_id,p.id);
  }
  const {historyBundle}=require('../scripts/history-bundle.cjs');
  const b=historyBundle();
  assert.equal(Object.keys(b.blobs).length,b.dataset.expected_counts.assets);
  assert.ok(Object.values(b.blobs).reduce((n,x)=>n+Buffer.from(x,'base64').length,0)<=1024*1024);
});

test('music search respects license expiry across the window',()=>{
  const active=at=>call(at,'library.search',{kind:'bgm',active:true}).items.map(t=>t.id);
  assert.ok(active('2025-08-31T23:59:59Z').includes('bgm-h04'));
  assert.ok(!active('2025-09-01T00:00:00Z').includes('bgm-h04'));
  assert.ok(active('2025-09-18T15:59:59Z').includes('bgm-h06'));
  assert.ok(!active('2025-09-18T16:00:00Z').includes('bgm-h06'));
});
