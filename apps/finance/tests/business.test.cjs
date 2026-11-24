'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {plugin, fixture, args, preview, event, approve, execute} = require('./support.cjs');
const code = value => error => error.code === value;

test('transfer conserves cash, consumes exact approval and replays one financial receipt', () => {
  const f = fixture(), initial = structuredClone(f.data), p = preview(f);
  assert.deepEqual(f.data.accounts, initial.accounts);
  assert.throws(() => execute(f, p), code('approval_required'));
  approve(f, p);
  const receipt = execute(f, p);
  assert.equal(f.data.accounts[0].balance_cents, 410000);
  assert.equal(f.data.accounts[2].balance_cents, 310000);
  assert.equal(f.data.accounts.reduce((n, a) => n + a.balance_cents, 0), 1520000);
  assert.deepEqual(execute(f, p), receipt);
  assert.equal(f.data.receipts.length, 1);
  assert.equal(f.data.proposals[0].approval.consumed, true);
  assert.deepEqual(plugin.handleTool(f.ctx, f.data, 'finance.receipts.get', {id: receipt.id}).result.receipt, receipt);
});

test('read operations preserve business state', () => {
  const f = fixture(), p = preview(f), initial = structuredClone(f.data);
  for (const [name, parameters] of [['finance.accounts.list', {}], ['finance.actions.get', {id: p.id}]]) {
    assert.deepEqual(plugin.handleTool(f.ctx, f.data, name, parameters).data, initial);
  }
});

test('rejects invalid endpoints, insufficient cash and fractional cents without changing input', () => {
  for (const parameters of [{...args.parameters, to_account: 'checking'},
    {...args.parameters, from_account: 'foreign-account'}, {...args.parameters, amount_cents: 99999999},
    {...args.parameters, amount_cents: 1.5}]) {
    const f = fixture(), initial = structuredClone(f.data);
    assert.throws(() => preview(f, {...args, parameters}));
    assert.deepEqual(f.data, initial);
  }
});

test('rejection and cancellation prevent execution', () => {
  const f = fixture(), rejected = preview(f);
  approve(f, rejected, 'reject');
  assert.throws(() => execute(f, rejected), code('approval_required'));
  const p = preview(f);
  approve(f, p);
  f.data = plugin.handleTool(f.ctx, f.data, 'finance.actions.cancel', {id: p.id}).data;
  assert.throws(() => execute(f, p), code('approval_required'));
  assert.equal(f.data.receipts.length, 0);
});

test('instruction revision invalidates an approved preview', () => {
  const f = fixture(), p = preview(f);
  approve(f, p);
  event(f, 'finance.instruction_updated', {instruction_revision: 2, text: 'Keep the cash in checking.', source_ref: 'user-turn-3'});
  assert.throws(() => execute(f, p), code('stale_instruction'));
});

test('only changes to a relevant account invalidate its preview', () => {
  const f = fixture(), p = preview(f);
  approve(f, p);
  event(f, 'finance.credit_posted', {account_id: 'savings', amount_cents: 1, source_ref: 'other-credit'});
  execute(f, p);
  const other = fixture(), q = preview(other);
  approve(other, q);
  event(other, 'finance.credit_posted', {account_id: 'checking', amount_cents: 1, source_ref: 'relevant-credit'});
  assert.throws(() => execute(other, q), code('stale_account'));
});

test('approval expiry and revocation prevent money movement', () => {
  const f = fixture(), p = preview(f);
  approve(f, p);
  f.ctx.virtual_now = p.expires_at;
  assert.throws(() => execute(f, p), code('expired'));
  const other = fixture(), q = preview(other);
  approve(other, q);
  event(other, 'finance.authority_revoked', {approval_id: 'approval-' + q.id, source_ref: 'user-revocation'});
  assert.throws(() => execute(other, q), code('approval_invalid'));
});

test('tampered previews, wrong decision revision and foreign identity are rejected', () => {
  const f = fixture(), p = preview(f);
  f.data.proposals[0].parameters.amount_cents++;
  assert.throws(() => approve(f, p), code('invalid_seed'));
  const other = fixture(), q = preview(other);
  assert.throws(() => approve(other, {...q, revision: 9}), code('invalid_event'));
  other.ctx.binding.accounts[0].owner_person_id = 'someone-else';
  assert.throws(() => plugin.validateSeed(other.ctx, other.data), code('invalid_seed'));
});

test('only Infra can record a decision, and one approval cannot cover two proposals', () => {
  const f = fixture(), p = preview(f);
  assert.throws(() => plugin.applyEvent(f.ctx, f.data, {operation: 'finance.decision_recorded', payload: {}}), code('permission_denied'));
  approve(f, p);
  const q = preview(f);
  assert.throws(() => event(f, 'finance.decision_recorded', {approval_id: 'approval-' + p.id,
    proposal_id: q.id, proposal_revision: 1, decision: 'approve', expires_at: q.expires_at, source_ref: 'user-turn'}), code('invalid_event'));
});

test('whole-share buys and sells update cash, quantity and cost once', () => {
  const f=fixture();
  const buy=preview(f,{kind:'buy',parameters:{account_id:'investing',instrument_id:'FUND1',quantity:2},reason:'Increase the approved position.'});
  assert.equal(buy.parameters.total_cents,10000);
  approve(f,buy);const receipt=execute(f,buy);
  assert.equal(f.data.accounts[2].balance_cents,290000);
  assert.equal(f.data.holdings[0].quantity,7);
  assert.equal(f.data.holdings[0].cost_cents,32500);
  assert.deepEqual(execute(f,buy),receipt);
  const sell=preview(f,{kind:'sell',parameters:{account_id:'investing',instrument_id:'FUND1',quantity:7},reason:'Sell the approved whole position.'});
  approve(f,sell);execute(f,sell);
  assert.equal(f.data.accounts[2].balance_cents,325000);
  assert.equal(f.data.holdings.length,0);
  assert.equal(f.data.transactions.filter(t=>t.receipt_id).length,2);
});

test('trade previews reject short sales, fractional shares and bank-account orders', () => {
  for(const parameters of [{account_id:'investing',instrument_id:'FUND1',quantity:6},
    {account_id:'investing',instrument_id:'FUND1',quantity:0.5},
    {account_id:'checking',instrument_id:'FUND1',quantity:1}]) {
    const f=fixture(),before=structuredClone(f.data);
    assert.throws(()=>preview(f,{kind:'sell',parameters,reason:'Invalid order'}));
    assert.deepEqual(f.data,before);
  }
});

test('a new quote invalidates an approved trade, even when the price stays equal', () => {
  const f=fixture(),p=preview(f,{kind:'buy',parameters:{account_id:'investing',instrument_id:'FUND1',quantity:1},reason:'An exact quoted order.'});
  approve(f,p);
  event(f,'finance.quote_published',{quote_id:'revised-quote',instrument_id:'FUND1',price_cents:5000,valid_until:'2026-12-01T09:10:00-08:00'});
  assert.throws(()=>execute(f,p),code('stale_quote'));
  assert.equal(f.data.accounts[2].balance_cents,300000);
  const read=plugin.handleTool(f.ctx,f.data,'finance.actions.get',{id:p.id});
  assert.equal(read.result.validity.valid_now,false);
});

test('market reads hide future observations and label expired quotes without mutating data', () => {
  const f=fixture();
  f.data.market_history.push({...f.data.market_history[0],id:'future-bar',as_of:'2027-01-01T00:00:00Z',available_at:'2027-01-01T00:00:00Z'});
  f.data.announcements.push({...f.data.announcements[0],id:'future-news',available_at:'2027-01-01T00:00:00Z'});
  f.data.quotes.push({...f.data.quotes[0],id:'future-quote',as_of:'2027-01-01T00:00:00Z',available_at:'2027-01-01T00:00:00Z',valid_until:'2027-01-01T00:10:00Z'});
  const before=structuredClone(f.data),read=plugin.handleTool(f.ctx,f.data,'finance.market.get',{});
  assert.equal(read.result.history.some(b=>b.id==='future-bar'),false);
  assert.equal(read.result.announcements.some(a=>a.id==='future-news'),false);
  assert.equal(read.result.quotes.some(q=>q.id==='future-quote'),false);
  assert.deepEqual(read.data,before);
  f.ctx.virtual_now='2026-12-01T09:10:00-08:00';
  assert.equal(plugin.handleTool(f.ctx,f.data,'finance.market.get',{}).result.quotes.every(q=>!q.executable),true);
  assert.throws(()=>preview(f,{kind:'buy',parameters:{account_id:'investing',instrument_id:'FUND1',quantity:1},reason:'Expired order'}),code('expired'));
});

test('failed debit preserves cash; a funded retry pays one occurrence only once', () => {
  const f=fixture(),payload={account_id:'checking',obligation_id:'rent',occurrence_id:'rent-december',amount_cents:450000};
  event(f,'finance.debit_due',payload);
  assert.equal(f.data.accounts[0].balance_cents,420000);
  assert.equal(f.data.transactions.at(-1).status,'failed');
  event(f,'finance.credit_posted',{account_id:'checking',amount_cents:200000,source_ref:'payroll'});
  event(f,'finance.debit_due',payload);
  assert.equal(f.data.accounts[0].balance_cents,170000);
  const before=structuredClone(f.data);
  event(f,'finance.debit_due',payload);
  assert.deepEqual(f.data,before);
  assert.equal(f.data.transactions.filter(t=>t.occurrence_id==='rent-december').length,2);
  assert.throws(()=>event(f,'finance.debit_due',{...payload,amount_cents:1}),code('invalid_event'));
});

test('daily fees honor the local cutoff and record assessed, paid and outstanding amounts once', () => {
  const f=fixture(),payload={account_id:'checking',rule_id:'daily-floor',business_date:'2026-12-01'};
  assert.throws(()=>event(f,'finance.balance_check',payload),code('invalid_event'));
  f.data.accounts[0].balance_cents=500;
  f.ctx.virtual_now='2026-12-01T23:59:00-08:00';
  event(f,'finance.balance_check',payload);
  assert.equal(f.data.accounts[0].balance_cents,0);
  assert.equal(f.data.assessments[0].assessed_cents,1000);
  assert.equal(f.data.assessments[0].paid_cents,500);
  assert.equal(f.data.assessments[0].outstanding_cents,500);
  const before=structuredClone(f.data);event(f,'finance.balance_check',payload);assert.deepEqual(f.data,before);
});

test('a no-fee daily assessment cannot later be assessed again after cash changes', () => {
  const f=fixture(),payload={account_id:'checking',rule_id:'daily-floor',business_date:'2026-12-01'};
  f.ctx.virtual_now='2026-12-01T23:59:00-08:00';event(f,'finance.balance_check',payload);
  assert.equal(f.data.assessments[0].assessed_cents,0);
  f.data.accounts[0].balance_cents=100;
  event(f,'finance.balance_check',payload);
  assert.equal(f.data.accounts[0].balance_cents,100);
  assert.equal(f.data.assessments.length,1);
});

test('fixture and schema generators reproduce the package in a disposable copy', () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
  const {spawnSync}=require('node:child_process');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-fixture-reproduction-'));
  const digest=directory=>{const hash=crypto.createHash('sha256');
    const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else{hash.update(path.relative(directory,p));hash.update(fs.readFileSync(p));}
    }};walk(directory);return hash.digest('hex');};
  try {
    fs.cpSync(path.resolve(__dirname,'..'),path.join(temp,'finance'),{recursive:true});
    const directory=path.join(temp,'finance'),before=digest(directory);
    for(const script of ['build-fixtures.py','build-schemas.py']) {
      const run=spawnSync('python3',['-B',path.join(directory,'scripts',script)],{encoding:'utf8'});
      assert.equal(run.status,0,run.stderr);
    }
    assert.equal(digest(directory),before);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('a timed-out pure computation retries identical input once; persistent timeout stays an error', () => {
  const {pythonRequest}=require('../src/bridge.cjs'),inputs=[];
  const input=JSON.stringify({mode:'tool',name:'finance.actions.execute',data:{receipt_count:0}});
  const result=pythonRequest(input,(_command,_args,options)=>{
    inputs.push(options.input);
    return inputs.length===1?{error:{code:'ETIMEDOUT'},status:null}:{status:0,stdout:'{"receipt_count":1}'};
  });
  assert.equal(result,'{"receipt_count":1}');assert.deepEqual(inputs,[input,input]);
  let attempts=0;
  assert.throws(()=>pythonRequest(input,()=>{attempts++;return {error:{code:'ETIMEDOUT'},status:null};}),code('finance_timeout'));
  assert.equal(attempts,2);
  assert.throws(()=>pythonRequest(input,()=>({error:{code:'ENOENT'},status:null})),code('finance_unavailable'));
});

test('real-data normalizers pass their offline source-contract checks without ARE', () => {
  const {spawnSync}=require('node:child_process'),path=require('node:path');
  const result=spawnSync('python3',['-B',path.join(__dirname,'market_data_test.py')],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
});
