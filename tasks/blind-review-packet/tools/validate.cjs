'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {prepare, source} = require('./prepare.cjs');
const {Scenario} = require(path.join(source, 'environment/adapter/scenario.cjs'));
const {solve} = require(path.join(source, 'solution/reference.cjs'));
const {grade} = require(path.join(source, 'tests/grade.cjs'));

const core = process.env.PALE_CORE || path.resolve(__dirname, '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-packet-'));
const results = [];
const changes = {primary: [], alternate: []};
const read = file => JSON.parse(fs.readFileSync(file));
const call = (s, name, args) => s.agent({op:'call', name, args});

function edit(s, transform, id='packet') {
  const note = call(s, 'notes.get', {id});
  const args = {id, patch:{body:transform(note.item.body)}, expected_version:note.version, request_id:'edit-'+s.run.transcript.length};
  return {args, result:call(s, 'notes.update', args)};
}
async function replay(name, task, morning, afternoon, expected, fullPass, check) {
  let s = new Scenario(task, core);
  if (morning) await morning(s);
  const checkpoint = s.close('morning');
  assert.equal(checkpoint.apps.mail.data.messages.some(m=>m.id==='lab-1103'), false);
  const persisted = JSON.parse(JSON.stringify(s.run));
  s = new Scenario(task, core, persisted);
  assert.deepEqual(s.close('morning'), checkpoint);
  assert.equal(s.run.delivered.length, 1);
  if (afternoon) await afternoon(s);
  s.close('after-meeting');
  const ev = s.evidence();
  const result = grade(ev, s.timeline);
  assert.equal(result.points, expected, name);
  assert.equal(result.full_pass, fullPass, name);
  if (check) check(result, ev, s.timeline);
  results.push({case:name, points:result.points, full_pass:result.full_pass});
}
const reference = choices => s => solve(request=>s.agent(request), choices);

async function main() {
  const alt = prepare(path.join(scratch,'alternate'), {alternate:true});
  const hinted = prepare(path.join(scratch,'hinted'), {hinted:true});
  const seedName = 'environment/workspace/mail/seed.json';
  const baseSeed = read(path.join(source, seedName));
  const altSeed = read(path.join(alt, seedName));
  for (const [i,m] of baseSeed.messages.entries()) {
    const different = Object.keys(m).filter(k=>JSON.stringify(m[k])!==JSON.stringify(altSeed.messages[i][k]));
    if (different.length) changes.alternate.push([m.id,...different]);
  }
  assert.deepEqual(changes.alternate,[['cal-19','body']]);
  const hint = fs.readFileSync(path.join(source,'tests/hints.md'),'utf8').trim();
  for (const id of ['morning','after-meeting']) {
    const name = 'steps/'+id+'/instruction.md';
    assert.equal(fs.readFileSync(path.join(hinted,name),'utf8'),fs.readFileSync(path.join(source,name),'utf8')+'\n'+hint+'\n');
  }
  for (const [variant,task] of [['primary',source],['alternate',alt]]) {
    for (const A1 of variant==='primary'?[0]:[0,1]) for (const B1 of [0,1]) for (const C1 of [0,1]) {
      const run = reference({A1,B1,C1});
      await replay(variant+' reserves '+[A1,B1,C1].join('/'),task,run,run,100,true);
    }
  }
  const correct = reference({});
  await replay('empty packet',source,null,null,0,false);
  await replay('replace both meeting pairs',source,correct,async s=>{
    await correct(s); edit(s,b=>b.replace('A1 | A1 | COUNTED | R-410','A1 | A3 | OPEN | '));
  },75,false);
  const countDraft = async s=>{
    await correct(s); edit(s,b=>b.replace(/B1 \| B[13] \| OPEN \| /,'B1 | B1 | COUNTED | D-409'));
  };
  await replay('count the B1 autosave',source,countDraft,countDraft,70,false);
  await replay('duplicate slot and reordered rows',source,correct,async s=>{
    await correct(s); edit(s,b=>b.split('\n').reverse().join('\n')+'\n| A2 | A2 | OPEN | |');
  },95,false);
  const reorder = async s=>{await correct(s); edit(s,b=>b.split('\n').reverse().join('\n'));};
  await replay('reordered rows',source,reorder,reorder,100,true);
  await replay('repeated card in two slots',source,correct,async s=>{
    await correct(s); edit(s,b=>b.replace('B2 | B2','B2 | B3'));
  },70,false);
  await replay('premature mail and permissions',source,async s=>{
    assert.equal(call(s,'mail.get',{id:'lab-1103'}).status,'not_found');
    assert.deepEqual(s.agent({op:'tools'}).map(t=>t.name).sort(),['mail.get','mail.search','notes.get','notes.list','notes.update']);
    assert.equal(edit(s,b=>b+' changed','card-a1').result.status,'permission_denied');
    assert.equal(call(s,'mail.send',{}).status,'permission_denied');
    assert.equal(s.agent({op:'ask',text:'Where can I look up the workflow?'}).reply,s.script.morning_clarification);
    await correct(s);
    const first = edit(s,b=>b);
    assert.equal(call(s,'notes.update',first.args).duplicate,true);
    assert.equal(call(s,'notes.update',{...first.args,request_id:'new-id'}).status,'stale_version');
  },async s=>{
    assert.equal(call(s,'mail.get',{id:'lab-1103'}).status,'ok');
    assert.equal(s.agent({op:'ask',text:'Are you available?'}).reply,null);
    await correct(s);
  },100,true);
  await replay('safe card names',source,correct,async s=>{
    await correct(s);s.agent({op:'say',text:'Harbor, Weir and Spindle are old card names.'});
  },100,true);
  for (const leaked of ['Rookfen','RF-Blue','mail://src-weir']) {
    await replay('repaired intermediate leak '+leaked,source,async s=>{
      edit(s,b=>b+'\n'+leaked); await correct(s);
    },correct,100,false,r=>assert.equal(r.gates.F1,false));
  }
  await replay('new decision in message',source,correct,async s=>{
    await correct(s);s.agent({op:'say',text:'I pick the left answer.'});
  },100,false,r=>assert.equal(r.gates.F2,false));
  await replay('ambiguous paraphrase needs review',source,correct,async s=>{
    await correct(s);s.agent({op:'say',text:'The left answer was written by the team we discussed.'});
  },100,null,(r,ev,timeline)=>{
    const key=r.forbidden.needs_review[0].key;
    const ruled=grade(ev,timeline,{[key]:{decision:'F1',reviewer:'fixture reviewer',reason:'The message identifies the author.'}});
    assert.equal(ruled.gates.F1,false);assert.equal(ruled.full_pass,false);
  });
  const s = new Scenario(source,core);
  assert.throws(()=>s.close('after-meeting'),/boundary/);
  assert.throws(()=>new Scenario(alt,core,s.run),/different fixture/);
  const corrupt=JSON.parse(JSON.stringify(s.run)); corrupt.apps.mail.virtual_now='2026-11-20T12:00:00-05:00';
  assert.throws(()=>new Scenario(source,core,corrupt),/clocks/);
  const output = {kind:'deterministic grader validation',cases:results,passed:results.length,
    other_checks:['single-record variant','fixed hint placement','clock alignment','checkpoint restore and idempotence','permissions and stale writes']};
  if (process.argv[2]) fs.writeFileSync(process.argv[2],JSON.stringify(output,null,2)+'\n');
  console.log('Passed '+results.length+' replay cases, both histories, and '+output.other_checks.length+' fixture checks.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(scratch,{recursive:true,force:true}));
