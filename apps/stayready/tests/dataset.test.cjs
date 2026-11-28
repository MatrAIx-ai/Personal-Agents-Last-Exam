'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {scenario}=require('../scripts/generate-dataset.cjs');
const root=path.resolve(__dirname,'../datasets');
const manifest=require('../datasets/manifest.json');
const read=file=>JSON.parse(fs.readFileSync(file));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const patterns=['arrival-mismatch','route-unavailable','breakfast-partial','guest-replaced'];

test('every delivered evaluation seed reproduces through public plugin operations and fixed business events',()=>{
  for(const entry of manifest.scenarios) {
    const year=Number(entry.scenario_id.slice(0,4)),month=Number(entry.scenario_id.slice(5,7));
    const generated=scenario(year,month,patterns.indexOf(entry.pattern));
    const bytes=fs.readFileSync(path.join(root,entry.file));
    assert.equal(hash(bytes),entry.sha256);
    assert.deepEqual(generated.data,JSON.parse(bytes),entry.scenario_id);
    assert.equal(generated.virtualNow,entry.initial_time);
    assert(generated.data.requests.every(r=>r.replies[0].outcome==='acknowledged'));
    assert(generated.data.requests.every(r=>Date.parse(r.submitted_at)<Date.parse(entry.initial_time)));
    assert(generated.data.history.every(h=>Date.parse(h.at)<Date.parse(entry.initial_time)));
  }
});

test('all four business situations survive varying person assignments, times and causal histories',()=>{
  for(const entry of manifest.scenarios) {
    const data=read(path.join(root,entry.file)),need=data.needs.find(n=>n.id===entry.focus_need_id),promise=data.commitments.find(c=>c.need_id===need.id);
    assert(promise&&promise.request_id,'The representative promise must derive from an actual historical request.');
    const request=data.requests.find(r=>r.id===promise.request_id);
    assert.equal(request.status,'confirmed');assert.deepEqual(request.final_reply.terms,promise.terms);
    if(entry.pattern==='arrival-mismatch')assert(Date.parse(need.conditions.arrival_at)>Date.parse(promise.terms.arrival_window.end));
    if(entry.pattern==='route-unavailable')assert(promise.unavailability.some(n=>Date.parse(n.effective_at)<=Date.parse(entry.initial_time)));
    if(entry.pattern==='breakfast-partial'){assert.equal(need.conditions.morning_dates.length,2);assert.equal(promise.terms.morning_dates.length,1);}
    if(entry.pattern==='guest-replaced'){assert(!data.stay.guest_person_ids.includes(need.person_ids[0]));assert.equal(promise.status,'active');}
  }
});

test('dataset contract declares the full library while runtime counts still describe its loaded baseline',()=>{
  const contribution=require('../contribution/dataset.json'),full=require('../datasets/declaration.json');
  const source=contribution.sources.find(s=>s.source_id==='authored-scenario-library');
  assert.equal(contribution.expected_counts.records,20);
  assert.equal(source.uri,'../datasets/declaration.json');
  assert.equal(source.generation.parameters.manifest,'../datasets/manifest.json');
  assert.equal(full.dataset_id,manifest.dataset_id);
  assert.equal(full.expected_counts.records,manifest.expected_counts.records);
  assert.equal(full.sources[0].kind,'synthetic');assert.equal(full.sources[0].uri,'manifest.json');
  assert.equal(manifest.timezone,'Europe/London');
});
