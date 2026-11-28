'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../plugin.cjs');
const initial = require('../fixtures/clock.json').initial_time;
const release = '2026-11-24T20:00:00Z';
function fixture() {
  const ctx = {virtual_now:initial,binding:require('../fixtures/binding.json'),run_id:'test'};
  let data=structuredClone(require('../fixtures/minimal.json'));
  return {
    ctx, snapshot:()=>structuredClone(data),
    call(op,args={}) {
      const out=app.handleTool(ctx,structuredClone(data),'cutroom.'+op,args);
      app.validateSeed(ctx,out.data);
      if(require('../tools.json').find(t=>t.name==='cutroom.'+op).read_only) assert.deepEqual(out.data,data);
      data=out.data;return out.result;
    },
    // Mirrors runtime env.apply_event: handler and validation see the event's
    // time; on any failure neither data nor the clock changes.
    event(at,op,payload) {
      const next={...ctx,virtual_now:at};
      const out=app.applyEvent(next,structuredClone(data),{at,operation:'cutroom.'+op,payload});
      app.validateSeed(next,out);data=out;ctx.virtual_now=at;
    },
    rejects(at,op,payload,code='invalid_event') {
      const before=structuredClone(data),clock=ctx.virtual_now;
      assert.throws(()=>this.event(at,op,payload),{code},`${op} ${JSON.stringify(payload)}`);
      assert.deepEqual(data,before);assert.equal(ctx.virtual_now,clock);
    },
  };
}
const revoke=(f,at)=>f.event(at,'license.revoke',{project_id:'ep15',resource_id:'bgm-synth-11',status:'revoked',reason:'License withdrawn'});
test('public release is blocked by both active-cut notes and the restricted track',()=>{
  const f=fixture(), before=f.snapshot();
  assert.deepEqual(f.call('projects.audit_clearance',{id:'ep14'}).blockers.map(b=>[b.code,b.target_id]),
    [['unresolved_note','benchmark'],['unresolved_note','screen'],['invalid_license','bgm-lofi-07']]);
  assert.throws(()=>f.call('projects.set_visibility',{id:'ep14',visibility:'public'}),{code:'clearance_blocked'});
  assert.deepEqual(f.snapshot(),before);
});
test('music search includes exact BPM and expiry boundaries; a swap fixes just the music blocker',()=>{
  const f=fixture();
  const search=max_bpm=>f.call('library.search',{kind:'bgm',mood:'upbeat',active:true,max_bpm,license_scope:'commercial_sponsored'}).items.map(t=>t.id);
  assert.deepEqual(search(115),['bgm-fast','bgm-synth-11','bgm-synth-12']);
  assert.deepEqual(search(114),['bgm-synth-11','bgm-synth-12']);
  assert.throws(()=>f.call('projects.schedule_release',{id:'ep15',at:'2026-11-25T00:00:01Z'}),{code:'clearance_blocked'});
  assert.equal(f.call('projects.schedule_release',{id:'ep15',at:'2026-11-25T00:00:00Z'}).item.schedule.at,'2026-11-25T00:00:00Z');
  const peer=f.call('projects.get',{id:'ep15'}).item;
  f.call('projects.assign_track',{id:'ep14',track_id:'bgm-synth-12'});
  assert.deepEqual(f.call('projects.get',{id:'ep15'}).item,peer);
  assert.deepEqual(f.call('projects.audit_clearance',{id:'ep14'}).blockers.map(b=>b.target_id),['benchmark','screen']);
});
test('release derives at the scheduled instant; a later revocation leaves it public',()=>{
  const f=fixture();
  f.call('projects.schedule_release',{id:'ep15',at:release});
  const before=f.snapshot();
  f.ctx.virtual_now=release;
  assert.equal(f.call('projects.get',{id:'ep15'}).item.published_at,release);
  assert.deepEqual(f.snapshot(),before);
  revoke(f,'2026-11-24T20:00:01Z');
  assert.equal(f.call('projects.get',{id:'ep15'}).item.visibility,'public');
  assert.equal(f.call('projects.audit_clearance',{id:'ep15'}).blockers[0].code,'invalid_license');
});
test('revocation before or exactly at release keeps it private and reports why',()=>{
  for(const at of ['2026-11-23T20:00:00Z',release]){
    const f=fixture();
    f.call('projects.schedule_release',{id:'ep15',at:release});
    revoke(f,at);f.ctx.virtual_now=release;
    const {item}=f.call('projects.get',{id:'ep15'});
    assert.equal(item.visibility,'private');
    assert.equal(item.release_blockers[0].code,'invalid_license');
  }
});
test('guest withdrawal and re-sign, independent overrides, and candidate ownership',()=>{
  const f=fixture(), before=f.snapshot();
  assert.throws(()=>f.call('projects.set_thumbnail',{id:'ep14',cut_id:'v2',asset_id:'thumb-b'}),{code:'not_found'});
  assert.deepEqual(f.snapshot(),before);
  const {item}=f.call('projects.set_thumbnail',{id:'ep14',cut_id:'v3',asset_id:'thumb-b'});
  assert.equal(item.cuts[1].active_thumbnail,'thumb-b');
  assert.deepEqual(item.cuts[0],before.projects[0].cuts[0]);
  assert.equal(item.visibility,'private');
  for(const status of ['withdrawn','signed']){
    f.event(initial,'license.revoke',{project_id:'ep14',resource_id:'guest-ep14',status,reason:'Guest decision'});
    assert.equal(f.call('projects.audit_clearance',{id:'ep14'}).blockers.some(b=>b.code==='missing_guest_release'),status==='withdrawn');
  }
  const override=f.call('projects.override_release',{id:'ep14',at:release,reason:'Internal simulated review'}).item.overrides[0];
  assert.deepEqual([override.actor,override.at,override.intended_transition.scheduled_at,override.blockers.length],
    ['person-editor',initial,release,3]);
  f.ctx.virtual_now=release;
  assert.equal(f.call('projects.get',{id:'ep14'}).item.visibility,'public');
});
test('every event type rejects unknown or mismatched targets without changing data or clock',()=>{
  const f=fixture(), at='2026-11-20T18:00:00Z', reason='Synthetic rejection probe';
  const revoke=(project_id,resource_id,status)=>f.rejects(at,'license.revoke',{project_id,resource_id,status,reason});
  revoke('ep-missing','bgm-lofi-07','revoked');      // unknown project
  revoke('ep14','bgm-missing','revoked');            // unknown resource
  revoke('ep14','bgm-synth-11','revoked');           // track assigned to another project
  revoke('ep14','bgm-lofi-07','withdrawn');          // music only accepts revoked
  revoke('ep14','guest-ep14','revoked');             // guests accept withdrawn/signed only
  revoke('ep15','guest-ep14','withdrawn');           // another project's guest release
  const note=(project_id,cut_id,note_id)=>f.rejects(at,'cut.add_note',{project_id,cut_id,note_id,timecode:'01:02',text:'Probe'});
  note('ep-missing','v3','probe');                   // unknown project
  note('ep14','v9','probe');                         // unknown cut
  note('ep15','v3','probe');                         // cut of another project
  note('ep14','v3','benchmark');                     // duplicate note ID
  const ab=(project_id,cut_id,asset_id)=>f.rejects(at,'ab_test.update',{project_id,cut_id,asset_id,ctr:0.05,retention:0.4});
  ab('ep-missing','v3','thumb-b');                   // unknown project
  ab('ep14','v9','thumb-b');                         // unknown cut
  ab('ep14','v2','thumb-b');                         // thumbnail of another cut
  ab('ep14','v3','ep15-thumb-a');                    // thumbnail of another project
  ab('ep14','v3','keyframe-0845');                   // a keyframe is not a candidate
  ab('ep14','v3','thumb-missing');                   // unknown asset
  f.rejects(at,'project.delete',{project_id:'ep14'});// undeclared operation
  // The same targets succeed when they match, so the rejections above are about the target.
  f.event(at,'cut.add_note',{project_id:'ep14',cut_id:'v3',note_id:'probe',timecode:'01:02',text:'Probe'});
  f.event(at,'ab_test.update',{project_id:'ep14',cut_id:'v3',asset_id:'thumb-b',ctr:0.05,retention:0.4});
  assert.equal(f.ctx.virtual_now,at);
});
test('a seed whose history is dated after the clock is rejected; plans may point forward',()=>{
  const ctx=clock=>({virtual_now:clock,binding:require('../fixtures/binding.json')});
  const seed=structuredClone(require('../fixtures/minimal.json'));
  app.validateSeed(ctx(initial),seed);
  assert.throws(()=>app.validateSeed({binding:ctx(initial).binding},seed),{code:'invalid_seed'});
  // The latest stored fact sets the earliest clock this seed can be loaded at.
  assert.throws(()=>app.validateSeed(ctx('2026-08-13T17:59:59Z'),seed),{code:'invalid_seed',message:/ep19\/v1/});
  app.validateSeed(ctx('2026-08-13T18:00:00Z'),seed);
  const late=(mutate,expected)=>{
    const copy=structuredClone(seed);mutate(copy);
    assert.throws(()=>app.validateSeed(ctx(initial),copy),{code:'invalid_seed',message:expected});
  };
  const after='2026-11-19T18:00:01Z', ep14=d=>d.projects[0], v3=d=>ep14(d).cuts[1];
  late(d=>{ep14(d).visibility='public';ep14(d).published_at=after;},/ep14\.published_at/);
  late(d=>{v3(d).notes[0].at=after;},/ep14\/v3\/benchmark\.at/);
  late(d=>{v3(d).notes[0].resolved_at=after;},/ep14\/v3\/benchmark\.resolved_at/);
  late(d=>{v3(d).results[0].at=after;},/results\/thumb-a\.at/);
  late(d=>{ep14(d).guest_releases[0].history.push({at:after,status:'withdrawn',reason:'Future'});},/guest-ep14\.history\.withdrawn/);
  late(d=>{d.library[0].history.push({at:after,status:'revoked',reason:'Future'});},/bgm-lofi-07\.history\.revoked/);
  late(d=>{ep14(d).overrides.push({actor:d.owner_person_id,at:after,intended_transition:{visibility:'public',scheduled_at:null},reason:'Future',blockers:[]});},/ep14\.overrides\.at/);
  const plans=structuredClone(seed);
  plans.projects[1].schedule={at:'2026-12-01T18:00:00Z',override:false};
  plans.library[0].expires_at='2027-01-01T00:00:00Z';
  app.validateSeed(ctx(initial),plans);
});
