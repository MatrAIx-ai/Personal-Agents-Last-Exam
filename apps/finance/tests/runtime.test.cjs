'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const runtime = path.resolve(process.env.PALE_RUNTIME_ROOT || path.join(__dirname, '../../..', 'runtime'));
const {prepare} = require(path.join(runtime, 'prepare.cjs'));
const {args} = require('./support.cjs');
test('trusted market snapshot reads retry transient locks within a fixed budget', async () => {
  const {readSnapshot}=require('../examples/market.cjs');
  let calls=0;const delays=[];
  const result=await readSnapshot({call:async name=>{
    assert.equal(name,'env.snapshot');
    if(++calls<3)throw Error('App is locked; retry later. No write was committed.');
    return {status:'ok'};
  }},async delay=>delays.push(delay));
  assert.equal(result.status,'ok');assert.equal(calls,3);assert.deepEqual(delays,[250,500]);
  calls=0;
  await assert.rejects(readSnapshot({call:async()=>{calls++;throw Error('Invalid state');}},async()=>{}),/Invalid state/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(readSnapshot({call:async()=>{calls++;throw Error('App is locked');}},async()=>{}),/App is locked/);
  assert.equal(calls,4);
});
function setup(t) {
  const p = prepare(path.resolve(__dirname, '..'));
  t.after(() => p.cleanup());
  let state = p.model.create('finance');
  return {
    get state() { return state; },
    call(role, name, args = {}) { const out = p.model.execute(state, role, name, args); state = out.state; return out.result; },
    write(name, args = {}, id = name) { return this.call('agent', name, {...args, request_id: id, expected_version: {epoch: state.epoch, revision: state.revision}}); },
    event(operation, payload, id = operation) { return this.call('infra', 'env.apply_event', {
      expected_version: {epoch: state.epoch, revision: state.revision},
      event: {event_id: id, at: state.virtual_now, operation, payload}}); }
  };
}
function approve(f, p) {
  const result = f.event('finance.decision_recorded', {approval_id: 'approval-' + p.id,
    proposal_id: p.id, proposal_revision: p.revision, decision: 'approve', expires_at: p.expires_at,
    source_ref: 'trusted-user-turn'}, 'decision-' + p.id);
  assert.equal(result.status, 'committed');
}

test('Core discovers writes correctly and deduplicates complete original requests', t => {
  const f = setup(t), before = structuredClone(f.state.data.accounts);
  const request = {...args, expected_version: {epoch: 1, revision: 0}, request_id: 'preview-1'};
  const first = f.call('agent', 'finance.actions.preview', request);
  assert.equal(first.status, 'committed');
  assert.equal(first.version.revision, 1);
  assert.deepEqual(f.state.data.accounts, before);
  assert.equal(f.call('agent', 'finance.actions.preview', request).duplicate, true);
  assert.equal(f.state.data.proposals.length, 1);
  assert.equal(f.call('agent', 'finance.actions.preview', {...request, reason: 'Different content'}).status, 'idempotency_conflict');
  assert.equal(f.call('agent', 'finance.actions.preview', {...request, request_id: 'new-id'}).status, 'stale_version');
  assert.equal(f.call('agent', 'finance.actions.preview', {...request, request_id: 'bad-money', parameters: {...args.parameters, amount_cents: 0.5}}).status, 'invalid_arguments');
});

test('Core separates Infra decisions from Agent calls and commits one transfer effect', t => {
  const f = setup(t), p = f.write('finance.actions.preview', args).proposal;
  assert.equal(f.call('agent', 'env.apply_event', {}).status, 'permission_denied');
  assert.equal(f.write('finance.actions.execute', {id: p.id}, 'not-approved').status, 'approval_required');
  approve(f, p);
  const request = {id: p.id, expected_version: {epoch: f.state.epoch, revision: f.state.revision}, request_id: 'execute-1'};
  const first = f.call('agent', 'finance.actions.execute', request);
  assert.equal(first.status, 'committed');
  assert.equal(f.call('agent', 'finance.actions.execute', request).duplicate, true);
  const repeated = f.write('finance.actions.execute', {id: p.id}, 'different-request-same-proposal');
  assert.deepEqual(repeated.receipt, first.receipt);
  assert.equal(f.state.data.receipts.length, 1);
  assert.equal(f.state.data.accounts[0].balance_cents, 410000);
  assert.equal(f.state.data.accounts[2].balance_cents, 310000);
});

test('instruction changes and virtual-time expiry deny execution without changing cash', t => {
  const f = setup(t), p = f.write('finance.actions.preview', args).proposal;
  approve(f, p);
  f.event('finance.instruction_updated', {instruction_revision: 2, text: 'Keep the cash.', source_ref: 'user-revision'});
  assert.equal(f.write('finance.actions.execute', {id: p.id}, 'stale-instruction').status, 'stale_instruction');
  const q = f.write('finance.actions.preview', args, 'fresh-preview').proposal;
  approve(f, q);
  const advanced = f.call('infra', 'env.advance_time', {expected_version: {epoch: f.state.epoch, revision: f.state.revision},
    request_id: 'advance-expiry', virtual_now: q.expires_at});
  assert.equal(advanced.status, 'committed');
  assert.equal(f.write('finance.actions.execute', {id: q.id}, 'expired').status, 'expired');
  assert.equal(f.state.data.accounts[0].balance_cents, 420000);
});

test('Core deduplicates credit events, rejects invalid seeds and resets to its loaded baseline', t => {
  const f = setup(t), initial = structuredClone(f.state.data);
  const request = {expected_version: {epoch: 1, revision: 0}, event: {event_id: 'credit-1',
    at: f.state.virtual_now, operation: 'finance.credit_posted',
    payload: {account_id: 'checking', amount_cents: 10000, source_ref: 'payroll'}}};
  assert.equal(f.call('infra', 'env.apply_event', request).status, 'committed');
  assert.equal(f.call('infra', 'env.apply_event', request).duplicate, true);
  assert.equal(f.state.data.accounts[0].balance_cents, 430000);
  const wrongOwner = structuredClone(initial); wrongOwner.owner_person_id = 'unbound';
  assert.equal(f.call('infra', 'env.load_seed', {expected_version: {epoch: 1, revision: 1}, data: wrongOwner}).status, 'invalid_seed');
  assert.equal(f.state.data.accounts[0].balance_cents, 430000);
  assert.equal(f.call('infra', 'env.reset', {expected_version: {epoch: 1, revision: 1}}).status, 'ready');
  assert.deepEqual(f.state.data, initial);
  assert.equal(f.state.epoch, 2);
});

test('actual MCP transport persists the approved transfer and original financial receipt', async () => {
  const report = await require('../examples/run-mcp.cjs').run();
  assert.equal(report.passed, true);
});

test('public tool schemas and Core commit whole-share fills and debit attempts', t => {
  const f=setup(t);
  const buy=f.write('finance.actions.preview',{kind:'buy',parameters:{account_id:'investing',instrument_id:'FUND1',quantity:2},reason:'Approved whole-share purchase.'});
  assert.equal(buy.status,'committed');approve(f,buy.proposal);
  const fill=f.write('finance.actions.execute',{id:buy.proposal.id},'buy-fill');
  assert.equal(fill.status,'committed');assert.equal(fill.receipt.position_effects[0].quantity_delta,2);
  assert.equal(f.call('agent','finance.holdings.list',{account_id:'investing'}).holdings[0].quantity,7);
  assert.equal(f.event('finance.debit_due',{account_id:'checking',obligation_id:'rent',occurrence_id:'rent-dec',amount_cents:450000}).status,'committed');
  assert.equal(f.call('agent','finance.transactions.list',{account_id:'checking'}).transactions.at(-1).status,'failed');
  assert.equal(f.call('agent','finance.market.get',{}).history.length,360);
});

test('Mail and Calendar walkthrough verifies actual receiver state and failure boundaries', async () => {
  assert.equal((await require('../examples/run-connected.cjs').run()).passed,true);
});

test('three generated scenes load and replay their scheduled events through Core', t => {
  const fs=require('node:fs'),f=setup(t),original=structuredClone(f.state);
  for(let number=1;number<=3;number++) {
    const read=suffix=>JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/scenes/scene-'+number+suffix+'.json')));
    const loaded=f.call('infra','env.load_seed',{expected_version:{epoch:f.state.epoch,revision:f.state.revision},
      data:read(''),binding:original.binding,bundle:original.resources.bundle,request_id:'scene-'+number,
      virtual_now:'2026-12-01T09:00:00-08:00'});
    assert.equal(loaded.status,'ready');assert.equal(f.state.data.holdings.length,number);
    for(const event of read('-events'))assert.equal(f.call('infra','env.apply_event',{
      expected_version:{epoch:f.state.epoch,revision:f.state.revision},event}).status,'committed');
    assert.equal(f.state.data.transactions.filter(r=>r.status==='failed').length,1);
    assert.equal(f.state.data.transactions.filter(r=>r.status==='paid').length,1);
    assert.equal(f.state.data.assessments[0].assessed_cents,number===2?1000:0);
    assert.equal(f.state.data.transactions.filter(r=>r.opening_history).length,12);
    assert.equal(f.call('infra','env.reset',{expected_version:{epoch:f.state.epoch,revision:f.state.revision}}).status,'ready');
    assert.deepEqual(f.state.data,read(''));
  }
});

test('loading executed history preserves original receipts without reapplying financial effects', t => {
  const f=setup(t),p=f.write('finance.actions.preview',args).proposal;approve(f,p);
  const receipt=f.write('finance.actions.execute',{id:p.id},'original-execute').receipt;
  const committed=structuredClone(f.state);
  assert.equal(f.call('infra','env.load_seed',{expected_version:{epoch:f.state.epoch,revision:f.state.revision},data:committed.data,
    virtual_now:committed.virtual_now,request_id:'load-executed-history'}).status,'ready');
  const repeated=f.write('finance.actions.execute',{id:p.id},'execute-after-history-load');
  assert.deepEqual(repeated.receipt,receipt);
  assert.deepEqual(f.state.data.accounts,committed.data.accounts);
  assert.equal(f.state.data.receipts.length,1);
});

test('distinct same-time attempts retain source event IDs without duplicating a paid occurrence', t => {
  const f=setup(t),payload={account_id:'checking',obligation_id:'rent',occurrence_id:'rent-repeat',amount_cents:450000};
  for(const id of ['attempt-a','attempt-b'])assert.equal(f.event('finance.debit_due',payload,id).status,'committed');
  assert.deepEqual(f.state.data.transactions.filter(r=>r.occurrence_id==='rent-repeat').map(r=>r.source_event_id),['attempt-a','attempt-b']);
  for(const id of ['credit-a','credit-b'])assert.equal(f.event('finance.credit_posted',{account_id:'checking',amount_cents:20000,source_ref:'separate-credit'},id).status,'committed');
  assert.equal(f.event('finance.debit_due',payload,'attempt-c').status,'committed');
  const paid=f.state.data.accounts[0].balance_cents;
  assert.equal(f.event('finance.debit_due',payload,'attempt-d').status,'committed');
  assert.equal(f.state.data.accounts[0].balance_cents,paid);
  assert.equal(f.state.data.transactions.filter(r=>r.occurrence_id==='rent-repeat'&&r.status==='paid').length,1);
});

test('captured real prices enter through Infra and replay the same observations offline', async t => {
  const fs=require('node:fs'),os=require('node:os'),{Client}=require(path.join(runtime,'client.cjs'));
  const {frame}=require('./market-support.cjs'),{record,readCapture,initialize,importFrame}=require('../examples/market.cjs');
  const p=prepare(path.resolve(__dirname,'..')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-capture-test-'));
  const clients=[];t.after(async()=>{await Promise.allSettled(clients.map(c=>c.close()));p.cleanup();fs.rmSync(temp,{recursive:true,force:true});});
  const connect=async(role,run)=>{const c=new Client('finance',role,run,path.join(p.root,'state'),'capture-test',{registry:p.registry});clients.push(c);await c.initialize();return c;};
  const first=frame(),second=frame('2026-12-01T21:01:00+00:00','234.12'),file=path.join(temp,'capture.json');
  record(file,first);record(file,second);const archived=readCapture(file);
  const live=await connect('infra','real-test'),agent=await connect('agent','real-test');
  await initialize(live,first,'live');
  let market=await agent.call('finance.market.get');
  assert.equal(market.source.mode,'live');assert.equal(market.quotes[0].price_cents,23346);
  assert.equal(market.quotes[0].provider,'yahoo_chart');
  assert.equal(market.history.some(r=>r.interval==='15m'),true);
  const state=await agent.call('finance.accounts.list');assert.equal((await agent.call('env.apply_event',{})).status,'permission_denied');
  const preview=await agent.call('finance.actions.preview',{kind:'buy',parameters:{account_id:'investing',instrument_id:'IBM',quantity:1},reason:'Use the observed real reference price in a local simulation.',expected_version:state.version,request_id:'real-preview'});
  assert.equal(preview.status,'committed');
  await importFrame(live,second,'live');
  assert.equal((await agent.call('finance.actions.get',{id:preview.proposal.id})).validity.valid_now,false);
  const replay=await connect('infra','replay-test'),replayAgent=await connect('agent','replay-test');
  await initialize(replay,archived.frames[0],'replay');await importFrame(replay,archived.frames[1],'replay');
  const liveMarket=await agent.call('finance.market.get'),replayed=await replayAgent.call('finance.market.get');
  assert.deepEqual(replayed.quotes,liveMarket.quotes);assert.deepEqual(replayed.history,liveMarket.history);assert.equal(replayed.source.mode,'replay');
  assert.equal((await importFrame(replay,archived.frames[1],'replay')).duplicate,true);
});

test('capture tampering, mixed providers and future collection barriers are rejected', t => {
  const {frame}=require('./market-support.cjs'),{verifyFrame,seedFor}=require('../examples/market.cjs'),{plugin,fixture}=require('./support.cjs');
  const original=frame(),damaged=structuredClone(original);damaged.responses[0].body+=' ';
  assert.throws(()=>verifyFrame(damaged),/hash mismatch/);
  const changed=structuredClone(original);changed.snapshot.quotes[0].price_cents++;
  assert.throws(()=>verifyFrame(changed),/snapshot hash mismatch/);
  const f=fixture();f.data=seedFor(original,'replay');f.ctx.virtual_now=original.snapshot.checked_at;
  const before=structuredClone(f.data),future=frame('2026-12-01T21:01:00+00:00');
  assert.throws(()=>plugin.applyEvent({...f.ctx,role:'infra'},f.data,{event_id:'future',operation:'finance.market_imported',payload:{mode:'replay',snapshot:future.snapshot}}),e=>e.code==='invalid_event');
  assert.deepEqual(f.data,before);
  const bad=structuredClone(original);bad.snapshot.provider='alphavantage_demo';
  assert.throws(()=>plugin.applyEvent({...f.ctx,role:'infra'},f.data,{event_id:'provider',operation:'finance.market_imported',payload:{mode:'replay',snapshot:bad.snapshot}}),e=>e.code==='invalid_event');
});
