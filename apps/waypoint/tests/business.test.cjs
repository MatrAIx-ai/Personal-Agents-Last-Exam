'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const {deliverable, settleEvent} = require('../src/settlement.cjs');

const code = value => ({code:value});
function unchanged(f, fn, expected) { const before = f.data; assert.throws(fn, expected); assert.deepEqual(f.data, before); }
const wireValid = compile(require('../schemas/loyalty-credit-message.schema.json'), path.resolve(__dirname, '../schemas'));
const transfer = (f, id) => f.call('waypoint.transfers.get', {id}).item;
const settle = (id, at, payload, eventId = 'settle-' + id + '-' + at) => ({event_id:eventId, at, operation:'waypoint.transfer.settle', payload:{transfer_id:id, ...payload}});
const credited = (app, account, eventId = 'router-abc') => ({outcome:'credited', receipt:{event_id:eventId, target_app_id:app, target_account_id:account}});
// Move the run clock forward between Agent calls, as Infra's env.advance_time does.
const clock = (f, iso) => { assert.ok(Date.parse(iso) >= Date.parse(f.ctx.virtual_now)); f.ctx.virtual_now = iso; };

// Mei's own account, built from the same binding: she combines into Daniel's account.
function meiSeed() {
  return {account_id:'waypoint-mei', owner_person_id:'person-mei', member_name:'Mei Cho',
    household:[{person_id:'person-daniel', name:'Daniel Cho', waypoint_account_id:'waypoint-daniel'}],
    balance:200000, ledger:[{id:'ledger-1', at:'2026-02-01T09:00:00-06:00', kind:'opening', points:200000, balance_after:200000, description:'Opening balance', ref:null}],
    partners:[], bonuses:[], transfers:[]};
}
function combineMessage({to = 'waypoint-daniel', points = 50000, from = 'waypoint-mei', member = 'person-daniel', kind = 'household_combine'} = {}) {
  return {specversion:'1.0', id:'credit-mei-1', source:'urn:pale:app:waypoint:account:' + from, type:'org.pale.loyalty.credit.v1',
    time:'2027-08-25T07:35:00-05:00', datacontenttype:'application/json', dataschema:'urn:pale:loyalty-credit:1',
    data:{channel:'channel.loyalty-credit', recipient:{kind:'app_account_ref', app_id:'waypoint', id:to},
      source_object:{app_id:'waypoint', account_id:from, object_type:kind === 'household_combine' ? 'combine' : 'transfer', object_id:'combine-1'},
      content:{kind, member_person_id:member, member_number:null, points, base_points:points, bonus_pct:0}, extensions:[]}};
}
const receive = (eventId, iso, message, recipient = 'waypoint-daniel') => ({event_id:eventId, at:iso, operation:'waypoint.receive', payload:{recipient_account_id:recipient, message}});

test('generated schemas and tools.json match their single source', () => {
  if (!fs.existsSync(path.resolve(__dirname, '../../../runtime/contracts/schemas/cloudevent.schema.json'))) return;
  require('../build/schemas.cjs').build({check:true});
});

test('the loyalty-credit contract copies match the receivers when they are present', () => {
  for (const app of ['skyline', 'harbor']) {
    for (const file of ['loyalty-credit-payload.schema.json', 'loyalty-credit-message.schema.json']) {
      const other = path.resolve(__dirname, '../../' + app + '/schemas/' + file);
      if (fs.existsSync(other)) assert.equal(fs.readFileSync(other, 'utf8'), fs.readFileSync(path.resolve(__dirname, '../schemas/' + file), 'utf8'), app + ' ' + file);
    }
  }
});

test('reads are side-effect free and report balance, partners, bonuses and transfers', () => {
  const f = fixture(), before = f.data;
  const balance = f.call('waypoint.balance', {});
  assert.deepEqual([balance.balance, balance.pending_points, balance.ledger.length, balance.household[0].person_id], [181600, 0, 4, 'person-mei']);
  assert.deepEqual(f.call('waypoint.partners', {}).items.map(p => [p.id, p.delay_minutes, p.bonus_pct_now]), [['skyline', 0, 0], ['harbor', 1440, 0]]);
  assert.deepEqual(f.call('waypoint.bonuses', {}).items.map(b => [b.id, b.state]), [['bonus-1', 'upcoming']]);
  assert.deepEqual(f.call('waypoint.transfers.list', {}).items.map(t => [t.id, t.status]), [['transfer-1', 'completed']]);
  assert.deepEqual(f.call('waypoint.transfers.list', {status:'pending'}).items, []);
  assert.deepEqual(f.data, before);
  assert.throws(() => f.call('waypoint.transfers.get', {id:'missing'}), code('not_found'));
});

test('a transfer must be a multiple of the increment, at least the minimum and covered by the balance', () => {
  const f = fixture();
  unchanged(f, () => f.call('waypoint.transfer', {partner_id:'skyline', points:1500}), code('invalid_amount'));
  unchanged(f, () => f.call('waypoint.transfer', {partner_id:'skyline', points:182000}), code('insufficient_points'));
  unchanged(f, () => f.call('waypoint.transfer', {partner_id:'northwind', points:1000}), code('not_found'));
  const data = f.data; data.partners[0].minimum = 5000; f.load(data);
  unchanged(f, () => f.call('waypoint.transfer', {partner_id:'skyline', points:4000}), code('invalid_amount'));
  const r = f.call('waypoint.transfer', {partner_id:'skyline', points:181000});
  assert.deepEqual([r.transfer_status, r.points, r.available_at], ['pending', 181000, '2027-08-24T21:00:00-05:00']);
  const after = f.data;
  assert.equal(after.balance, 600);
  assert.deepEqual(after.ledger.at(-1), {id:'ledger-5', at:'2027-08-24T21:00:00-05:00', kind:'transfer_out', points:-181000, balance_after:600,
    description:'Transfer to Skyline Miles', ref:{kind:'transfer', id:r.id}});
  assert.equal(f.call('waypoint.balance', {}).pending_points, 181000);
});

test('a transfer is irreversible: there is no cancel, and only a recorded rejection refunds it', () => {
  const tools = require('../tools.json').map(t => t.name);
  assert.ok(!tools.some(n => /cancel|reverse|undo/.test(n)));
  const f = fixture();
  const r = f.call('waypoint.transfer', {partner_id:'skyline', points:20000});
  f.event(settle(r.id, '2027-08-24T21:00:05-05:00', {outcome:'rejected', rejection:{code:'receiver_rejected', reason:'permission_denied'}}));
  const t = transfer(f, r.id), data = f.data;
  assert.deepEqual([t.status, t.rejection.code, data.balance], ['rejected', 'receiver_rejected', 181600]);
  assert.deepEqual(data.ledger.at(-1).kind, 'refund');
  assert.equal(data.ledger.at(-1).id, t.refund_ledger_id);
  // The refund is applied once; a second outcome for the same transfer is refused.
  unchanged(f, () => f.event(settle(r.id, '2027-08-24T21:01:00-05:00', {outcome:'rejected', rejection:{code:'receiver_rejected', reason:''}})), code('invalid_state'));
  unchanged(f, () => f.call('waypoint.transfer.outbound', {id:r.id}), code('invalid_state'));
});

test('a transfer bonus applies inside its window: start inclusive, end exclusive', () => {
  const f = fixture();
  clock(f, '2027-08-31T23:59:59-05:00');
  assert.equal(f.call('waypoint.transfer', {partner_id:'skyline', points:10000}).bonus_pct, 0);
  clock(f, '2027-09-01T00:00:00-05:00');
  assert.equal(f.call('waypoint.partners', {}).items[0].active_bonus_id, 'bonus-1');
  const inside = f.call('waypoint.transfer', {partner_id:'skyline', points:10000});
  assert.deepEqual([inside.bonus_pct, inside.points], [30, 13000]);
  assert.equal(f.call('waypoint.transfer', {partner_id:'harbor', points:10000}).bonus_pct, 0, 'a bonus is per partner');
  clock(f, '2027-09-16T00:00:00-05:00');
  assert.deepEqual(f.call('waypoint.bonuses', {}).items.find(b => b.id === 'bonus-1').state, 'ended');
  assert.equal(f.call('waypoint.transfer', {partner_id:'skyline', points:10000}).bonus_pct, 0);
});

test('the ratio and bonus round the partner credit down', () => {
  const f = fixture(), data = f.data;
  data.partners[1].ratio = {from:3, to:2}; f.load(data);
  f.event(require('../examples/scenario.json'));
  clock(f, '2027-10-01T00:00:00-05:00');
  const r = f.call('waypoint.transfer', {partner_id:'harbor', points:7000}); // 7000 × 2/3 × 1.2 = 5600
  assert.deepEqual([r.bonus_pct, r.points], [20, 5600]);
  const r2 = f.call('waypoint.transfer', {partner_id:'harbor', points:1000}); // 1000 × 2/3 × 1.2 = 800
  assert.equal(r2.points, 800);
});

test('a delayed transfer is released after the partner delay, keeping the time zone offset', () => {
  const f = fixture();
  const r = f.call('waypoint.transfer', {partner_id:'harbor', points:30000});
  assert.equal(r.available_at, '2027-08-25T21:00:00-05:00');
  unchanged(f, () => f.call('waypoint.transfer.outbound', {id:r.id}), code('not_due'));
  unchanged(f, () => f.event(settle(r.id, '2027-08-25T20:59:59-05:00', credited('harbor', 'harbor-daniel'))), code('not_due'));
  assert.deepEqual(deliverable(f.data, '2027-08-25T20:59:59-05:00'), []);
  assert.deepEqual(deliverable(f.data, '2027-08-25T21:00:00-05:00').map(t => t.id), [r.id]);
  clock(f, '2027-08-25T21:00:00-05:00');
  assert.ok(wireValid(f.call('waypoint.transfer.outbound', {id:r.id}).message));
  f.event(settle(r.id, '2027-08-25T21:00:00-05:00', credited('harbor', 'harbor-daniel')));
  const t = transfer(f, r.id);
  assert.deepEqual([t.status, t.settled_at, t.receipt.target_account_id], ['completed', '2027-08-25T21:00:00-05:00', 'harbor-daniel']);
});

test('the outbound message is stable, routed to the member\'s own partner account and valid on the wire', () => {
  const f = fixture();
  const r = f.call('waypoint.transfer', {partner_id:'skyline', points:150000});
  const m = f.call('waypoint.transfer.outbound', {id:r.id}).message;
  assert.ok(wireValid(m));
  assert.deepEqual([m.source, m.time, m.data.recipient, m.data.source_object.object_id], ['urn:pale:app:waypoint:account:waypoint-daniel',
    '2027-08-24T21:00:00-05:00', {kind:'app_account_ref', app_id:'skyline', id:'skyline-daniel'}, r.id]);
  assert.deepEqual(m.data.content, {kind:'partner_transfer', member_person_id:'person-daniel', member_number:'SK-48210377', points:150000, base_points:150000, bonus_pct:0});
  f.event(settle(r.id, '2027-08-24T21:00:02-05:00', credited('skyline', 'skyline-daniel', 'router-1')));
  assert.deepEqual(f.call('waypoint.transfer.outbound', {id:r.id}).message, m, 'a completed transfer keeps its message identity for retries');
  const other = f.call('waypoint.transfer', {partner_id:'skyline', points:1000});
  assert.notEqual(f.call('waypoint.transfer.outbound', {id:other.id}).message.id, m.id);
});

test('a settlement must match the transfer route and carry exactly one outcome', () => {
  const f = fixture();
  const r = f.call('waypoint.transfer', {partner_id:'skyline', points:5000});
  unchanged(f, () => f.event(settle(r.id, '2027-08-24T21:00:01-05:00', credited('harbor', 'harbor-daniel'))), code('invalid_event'));
  unchanged(f, () => f.event(settle(r.id, '2027-08-24T21:00:01-05:00', {outcome:'credited'})), code('invalid_event'));
  unchanged(f, () => f.event(settle(r.id, '2027-08-24T21:00:01-05:00', {outcome:'rejected'})), code('invalid_event'));
  unchanged(f, () => f.event(settle(r.id, '2027-08-24T21:00:01-05:00', {...credited('skyline', 'skyline-daniel'), rejection:{code:'x', reason:''}})), code('invalid_event'));
  unchanged(f, () => f.event(settle('transfer-9', '2027-08-24T21:00:01-05:00', credited('skyline', 'skyline-daniel'))), code('not_found'));
  f.event(settle(r.id, '2027-08-24T21:00:01-05:00', credited('skyline', 'skyline-daniel')));
  unchanged(f, () => f.event(settle(r.id, '2027-08-24T21:00:02-05:00', credited('skyline', 'skyline-daniel'), 'settle-again')), code('invalid_state'));
  unchanged(f, () => f.event(settle('transfer-1', '2027-08-24T21:00:02-05:00', credited('harbor', 'harbor-daniel'))), code('invalid_state'));
});

test('combine sends only the member\'s own points to another household member', () => {
  const f = fixture();
  unchanged(f, () => f.call('waypoint.combine', {to_person_id:'person-daniel', points:1000}), code('invalid_arguments'));
  unchanged(f, () => f.call('waypoint.combine', {to_person_id:'person-stranger', points:1000}), code('permission_denied'));
  unchanged(f, () => f.call('waypoint.combine', {to_person_id:'person-mei', points:181601}), code('insufficient_points'));
  const tools = require('../tools.json').find(t => t.name === 'waypoint.combine');
  assert.deepEqual(Object.keys(tools.inputSchema.properties).sort(), ['expected_version', 'points', 'request_id', 'to_person_id'], 'no source member can be named');
  const r = f.call('waypoint.combine', {to_person_id:'person-mei', points:1234});
  const m = f.call('waypoint.transfer.outbound', {id:r.id}).message;
  assert.ok(wireValid(m));
  assert.deepEqual([m.data.recipient.app_id, m.data.recipient.id, m.data.source_object.object_type, m.data.content.member_person_id],
    ['waypoint', 'waypoint-mei', 'combine', 'person-mei']);
  assert.equal(f.data.ledger.at(-1).kind, 'combine_out');
});

test('a household combine credits the receiving member once, and every other sender is refused', () => {
  const f = fixture();
  f.event(receive('router-c1', '2027-08-25T07:40:00-05:00', combineMessage()));
  const row = f.data.ledger.at(-1);
  assert.deepEqual([row.id, row.kind, row.points, row.balance_after, row.ref.account_id, row.ref.sent_at],
    ['router-c1', 'combine_in', 50000, 231600, 'waypoint-mei', '2027-08-25T07:35:00-05:00']);
  unchanged(f, () => f.event(receive('router-c1', '2027-08-25T07:41:00-05:00', combineMessage())), code('already_exists'));
  unchanged(f, () => f.event(receive('router-c2', '2027-08-25T07:41:00-05:00', combineMessage(), 'waypoint-mei')), code('invalid_event'));
  unchanged(f, () => f.event(receive('router-c3', '2027-08-25T07:41:00-05:00', combineMessage({to:'waypoint-mei'}))), code('invalid_event'));
  unchanged(f, () => f.event(receive('router-c4', '2027-08-25T07:41:00-05:00', combineMessage({kind:'partner_transfer'}))), code('invalid_event'));
  unchanged(f, () => f.event(receive('router-c5', '2027-08-25T07:41:00-05:00', combineMessage({member:'person-mei'}))), code('permission_denied'));
  unchanged(f, () => f.event(receive('router-c6', '2027-08-25T07:41:00-05:00', combineMessage({from:'waypoint-daniel'}))), code('permission_denied'));
  unchanged(f, () => f.event(receive('router-c7', '2027-08-25T07:41:00-05:00', combineMessage({from:'waypoint-unbound'}))), code('permission_denied'));
});

test('the sending member\'s side: Mei combines into Daniel\'s account and settles with the receipt', () => {
  const f = fixture();
  f.load(meiSeed());
  const r = f.call('waypoint.combine', {to_person_id:'person-daniel', points:166000});
  const m = f.call('waypoint.transfer.outbound', {id:r.id}).message;
  assert.equal(m.data.recipient.id, 'waypoint-daniel');
  f.event(settle(r.id, '2027-08-24T21:00:03-05:00', credited('waypoint', 'waypoint-daniel')));
  assert.deepEqual([transfer(f, r.id).status, f.data.balance], ['completed', 34000]);
  // Daniel's account accepts exactly that message.
  const d = fixture();
  d.event(receive('router-from-mei', '2027-08-24T21:00:03-05:00', m));
  assert.equal(d.data.balance, 181600 + 166000);
});

test('bonuses are announced and ended early by Infra events', () => {
  const f = fixture();
  unchanged(f, () => f.event({event_id:'b1', at:'2027-08-25T09:00:00-05:00', operation:'waypoint.bonus.start',
    payload:{bonus:{id:'bonus-x', partner_id:'northwind', percent:10, starts_at:'2027-09-01T00:00:00-05:00', ends_at:'2027-09-02T00:00:00-05:00'}}}), code('not_found'));
  unchanged(f, () => f.event({event_id:'b2', at:'2027-08-25T09:00:00-05:00', operation:'waypoint.bonus.start',
    payload:{bonus:{id:'bonus-x', partner_id:'skyline', percent:10, starts_at:'2027-09-10T00:00:00-05:00', ends_at:'2027-09-20T00:00:00-05:00'}}}), code('invalid_seed'));
  unchanged(f, () => f.event({event_id:'b3', at:'2027-08-25T09:00:00-05:00', operation:'waypoint.bonus.start',
    payload:{bonus:{id:'bonus-1', partner_id:'harbor', percent:10, starts_at:'2027-09-10T00:00:00-05:00', ends_at:'2027-09-20T00:00:00-05:00'}}}), code('already_exists'));
  unchanged(f, () => f.event({event_id:'b4', at:'2027-08-25T09:00:00-05:00', operation:'waypoint.bonus.start',
    payload:{bonus:{id:'bonus-y', partner_id:'harbor', percent:10, starts_at:'2027-08-01T00:00:00-05:00', ends_at:'2027-08-20T00:00:00-05:00'}}}), code('invalid_event'));
  unchanged(f, () => f.event({event_id:'e1', at:'2027-08-25T09:00:00-05:00', operation:'waypoint.bonus.end', payload:{bonus_id:'bonus-1'}}), code('invalid_state'));
  f.event({event_id:'e2', at:'2027-09-05T12:00:00-05:00', operation:'waypoint.bonus.end', payload:{bonus_id:'bonus-1'}});
  const b = f.call('waypoint.bonuses', {}).items[0];
  assert.deepEqual([b.ends_at, b.state, b.history.at(-1).action], ['2027-09-05T12:00:00-05:00', 'ended', 'bonus_ended_early']);
  assert.equal(f.call('waypoint.transfer', {partner_id:'skyline', points:1000}).bonus_pct, 0);
  unchanged(f, () => f.event({event_id:'e3', at:'2027-09-06T12:00:00-05:00', operation:'waypoint.bonus.end', payload:{bonus_id:'bonus-1'}}), code('invalid_state'));
});

test('the runner helper maps router results to settlements and leaves unknown outcomes pending', () => {
  const t = {id:'transfer-7'}, iso = '2027-08-25T09:00:00-05:00';
  assert.deepEqual(settleEvent(t, {status:'committed', event_id:'router-1', target:{app_id:'skyline', account_id:'skyline-daniel'}}, iso).payload,
    {transfer_id:'transfer-7', outcome:'credited', receipt:{event_id:'router-1', target_app_id:'skyline', target_account_id:'skyline-daniel'}});
  assert.deepEqual(settleEvent(t, {status:'rejected', code:'receiver_rejected', reason:'permission_denied', stop_run:true}, iso).payload.rejection,
    {code:'receiver_rejected', reason:'permission_denied'});
  assert.equal(settleEvent(t, {status:'rejected', code:'recipient_unavailable'}, iso).payload.outcome, 'rejected');
  assert.equal(settleEvent(t, {status:'unknown', code:'receiver_unconfirmed', stop_run:true}, iso), null);
  assert.equal(settleEvent(t, {status:'halted', code:'run_halted'}, iso), null);
  assert.equal(settleEvent(t, {status:'rejected', code:'idempotency_conflict'}, iso), null);
  assert.equal(settleEvent(t, {status:'committed', event_id:'router-1', target:{app_id:'skyline', account_id:'skyline-daniel'}}, iso).event_id, 'settle-transfer-7');
});

test('seed validation rejects broken ledgers, foreign routes and inconsistent transfers', () => {
  const f = fixture();
  const mutate = fn => { const d = f.data; fn(d); return d; };
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.balance = 1; })), /ledger total/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.ledger[1].balance_after = 1; })), /running balance/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.ledger[1].at = '2025-01-01T00:00:00Z'; })), /time order/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.partners[0].recipient_account_id = 'waypoint-mei'; })), /own/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.household[0].waypoint_account_id = 'waypoint-daniel'; })), /their own/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.transfers[0].receipt = null; })), /receipt/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.transfers[0].points = 1; })), /credit/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.transfers[0].debit_ledger_id = 'ledger-1'; })), /debit/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.transfers[0].receipt.target_account_id = 'skyline-daniel'; })), /another account/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.account_id = 'waypoint-mei'; })), /binding/);
  assert.throws(() => plugin.validateSeed(f.ctx, mutate(d => { d.bonuses[0].ends_at = d.bonuses[0].starts_at; })), /empty/);
});

test('optional diagnostics cannot change business results and carry IDs only', () => {
  const on = fixture(), off = fixture({logging:false});
  for (const f of [on, off]) { f.event(require('../examples/scenario.json')); f.call('waypoint.combine', {to_person_id:'person-mei', points:500}); }
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => !JSON.stringify(l).includes('Mei Cho') && !JSON.stringify(l).includes('Combined')), 'logs carry IDs, not names or descriptions');
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  broken.event(require('../examples/scenario.json')); broken.call('waypoint.combine', {to_person_id:'person-mei', points:500});
  assert.deepEqual(broken.data, off.data);
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', description:'<img src=x onerror=alert(1)>', name:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});
