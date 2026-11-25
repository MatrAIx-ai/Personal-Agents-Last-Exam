'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const {addMonths} = require('../src/dates.cjs');
const {computation, DEFAULT_HOLIDAYS} = require('../src/office.cjs');

const code = value => ({code:value});
function unchanged(f, fn, expected) { const before = f.data; assert.throws(fn, expected); assert.deepEqual(f.data, before); }
const status = f => f.call('passage.documents.status', {});
const requests = f => f.call('passage.requests.list', {}).items;
const submit = f => f.call('passage.travel_signature.request', {});
const SCENARIO = require('../examples/scenario.json');
const runtimeDir = path.resolve(__dirname, '../../../runtime');

function processed({request_id = 'req-0142', at = '2027-02-15T10:00:00-06:00', eventId = 'processed-' + request_id + '-' + at.replace(/[^0-9]/g, ''),
  submitted_on = '2027-02-08', business_days = 5, counted_days = ['2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12', '2027-02-15'],
  skipped_holidays = [], due_on = counted_days.at(-1)} = {}) {
  return {event_id:eventId, at, operation:'passage.request.processed', payload:{request_id, submitted_on, business_days, counted_days, skipped_holidays, due_on}};
}
function seeded(fn) { const f = fixture(); const data = f.data; fn(data); f.load(data); return f; }
// The fixture without the request submitted on 2027-02-08: a student who has not asked yet.
const fresh = (fn = () => {}) => seeded(d => { d.requests = d.requests.filter(r => r.id !== 'req-0142'); d.notices = d.notices.filter(n => n.ref.object_id !== 'req-0142'); fn(d); });

test('generated schemas and tools.json match their single source', () => {
  if (!fs.existsSync(path.resolve(__dirname, '../../../examples/apps/mail/schemas/router-message.schema.json'))) return;
  require('../build/schemas.cjs').build({check:true});
  assert.deepEqual(require('../tools.json').map(t => t.name), ['passage.travel_signature.request', 'passage.requests.list', 'passage.documents.status']);
});

test('read tools change nothing and report the I-20 signature, its lapse date and the pending request', () => {
  const f = fixture(), before = f.data;
  const s = status(f), doc = s.documents[0];
  assert.deepEqual([s.as_of, s.today, s.timezone], ['2027-02-08T20:30:00-06:00', '2027-02-08', 'America/Chicago']);
  assert.deepEqual([doc.id, doc.holder_name, doc.travel_signature_status, doc.pending_request_id], ['i20-mingyu', 'ZHAO Mingyu', 'valid', 'req-0142']);
  assert.deepEqual(doc.current_signature, {id:'sig-0141', request_id:'req-0141', document_id:'i20-mingyu', issued_at:'2026-03-09T14:00:00-05:00',
    signed_on:'2026-03-09', valid_until:'2027-03-09', status:'valid', days_until_lapse:29});
  assert.deepEqual(requests(f).map(r => [r.id, r.status, r.submitted_on, r.due_on, r.signature_id]),
    [['req-0142', 'submitted', '2027-02-08', '2027-02-15', null], ['req-0141', 'processed', '2026-03-02', '2026-03-09', 'sig-0141']]);
  assert.deepEqual(f.data, before);
});

test('a request is processed on the 5th business day: the processed event issues a 12-month signature and a notice', () => {
  const f = fixture();
  f.event(SCENARIO);
  const r = requests(f)[0], d = f.data, sig = d.signatures.find(x => x.id === 'sig-0142');
  assert.deepEqual([r.id, r.status, r.processed_at, r.processed_event_id, r.signature_id, r.history.map(h => h.action)],
    ['req-0142', 'processed', '2027-02-15T10:00:00-06:00', 'processed-req-0142', 'sig-0142', ['submitted', 'processed']]);
  assert.deepEqual(sig, {id:'sig-0142', request_id:'req-0142', document_id:'i20-mingyu', issued_at:'2027-02-15T10:00:00-06:00', signed_on:'2027-02-15', valid_until:'2028-02-15'});
  const n = d.notices.at(-1);
  assert.deepEqual([n.id, n.kind, n.created_at, n.ref], ['notice-4', 'signature_issued', '2027-02-15T10:00:00-06:00', {object_type:'travel_signature', object_id:'sig-0142'}]);
  assert.match(n.body, /signed for travel on 2027-02-15\. The travel signature is valid until 2028-02-15/);
  const doc = status(f).documents[0];
  assert.deepEqual([doc.travel_signature_status, doc.current_signature.id, doc.pending_request_id, doc.signatures.map(x => [x.id, x.status])],
    ['valid', 'sig-0142', null, [['sig-0142', 'valid'], ['sig-0141', 'valid']]]);
  // The snapshot shapes the trip task (#49) reads.
  const req = d.requests.find(x => x.id === 'req-0142');
  assert.deepEqual({id:req.id, kind:req.kind, status:req.status, signature_id:req.signature_id}, {id:'req-0142', kind:'travel_signature', status:'processed', signature_id:'sig-0142'});
  assert.equal(req.submitted_at, '2027-02-08T20:30:00-06:00');
});

test('a fresh request counts business days after the submission date, skipping weekends and the holiday in between', () => {
  // Thursday 2027-01-14, late evening: day 0 is still the 14th. Fri 15, (weekend), Mon 18 is MLK Day, then 19-22.
  const f = fresh();
  f.ctx.virtual_now = '2027-01-15T05:30:00Z'; // 23:30 on 14 January in Chicago
  const out = submit(f);
  assert.deepEqual([out.created, out.notice_id, out.request.id, out.request.submitted_on, out.request.business_days, out.request.due_on, out.request.status],
    [true, 'notice-3', 'req-0142', '2027-01-14', 5, '2027-01-22', 'submitted']);
  const receipt = f.data.notices.at(-1);
  assert.deepEqual([receipt.kind, receipt.ref], ['request_received', {object_type:'travel_signature_request', object_id:'req-0142'}]);
  assert.match(receipt.body, /processed in 5 business days.*expected on 2027-01-22/s);
  const plan = computation(f.data, '2027-01-14');
  assert.deepEqual([plan.counted_days, plan.skipped_holidays], [['2027-01-15', '2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22'], ['2027-01-18']]);
  const good = {request_id:'req-0142', submitted_on:'2027-01-14', counted_days:plan.counted_days, skipped_holidays:['2027-01-18']};
  // Early: one second before the due date begins at the office.
  unchanged(f, () => f.event(processed({...good, at:'2027-01-21T23:59:59-06:00'})), code('not_due'));
  // Incorrect: a computation that counts the holiday as a business day.
  unchanged(f, () => f.event(processed({...good, at:'2027-01-22T09:00:00-06:00', counted_days:['2027-01-15', '2027-01-18', '2027-01-19', '2027-01-20', '2027-01-21'], skipped_holidays:[]})), code('invalid_event'));
  f.event(processed({...good, at:'2027-01-22T00:00:00-06:00'}));
  assert.deepEqual(f.data.signatures.at(-1), {id:'sig-0142', request_id:'req-0142', document_id:'i20-mingyu', issued_at:'2027-01-22T00:00:00-06:00', signed_on:'2027-01-22', valid_until:'2028-01-22'});
  // A later request takes the next number.
  f.ctx.virtual_now = '2027-06-01T09:00:00-05:00';
  assert.equal(submit(f).request.id, 'req-0143');
});

test('the holiday table is seed data: absent uses the default, an empty table means Monday to Friday only', () => {
  const noHolidays = fresh(d => { d.holidays = []; });
  noHolidays.ctx.virtual_now = '2027-01-14T10:00:00-06:00';
  assert.equal(submit(noHolidays).request.due_on, '2027-01-21');
  const defaults = fresh(d => { delete d.holidays; });
  defaults.ctx.virtual_now = '2027-01-14T10:00:00-06:00';
  assert.equal(submit(defaults).request.due_on, '2027-01-22');
  assert.deepEqual(fixture().data.holidays, DEFAULT_HOLIDAYS);
  // Thanksgiving week and a Saturday submission.
  const sat = fresh(d => { d.rules.processing_business_days = 4; });
  sat.ctx.virtual_now = '2027-11-20T12:00:00-06:00';
  assert.deepEqual([submit(sat).request.due_on, computation(sat.data, '2027-11-20').skipped_holidays], ['2027-11-29', ['2027-11-25', '2027-11-26']]);
  // A seed whose pending request no longer follows its holiday table is rejected.
  assert.throws(() => seeded(d => { d.holidays.push({date:'2027-02-12', name:'Closure'}); }), /due_on/);
});

test('an early or incorrect processed event is rejected with no state change', () => {
  const f = fixture();
  unchanged(f, () => f.event(processed({at:'2027-02-12T16:00:00-06:00'})), code('not_due'));
  unchanged(f, () => f.event(processed({at:'2027-02-14T23:59:59-06:00'})), code('not_due'));
  // The task's computation must match the App's own rule field by field.
  unchanged(f, () => f.event(processed({at:'2027-02-12T16:00:00-06:00', business_days:4, counted_days:['2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12']})), code('invalid_event'));
  unchanged(f, () => f.event(processed({counted_days:['2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12', '2027-02-13']})), code('invalid_event'));
  unchanged(f, () => f.event(processed({submitted_on:'2027-02-09'})), code('invalid_event'));
  unchanged(f, () => f.event(processed({skipped_holidays:['2027-02-15']})), code('invalid_event'));
  unchanged(f, () => f.event(processed({due_on:'2027-02-16'})), code('invalid_event'));
  assert.throws(() => f.event(processed({business_days:4, counted_days:['2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12']})), /counted 2027-02-09, 2027-02-10, 2027-02-11, 2027-02-12, 2027-02-15; due on 2027-02-15/);
  unchanged(f, () => f.event(processed({request_id:'req-0999'})), code('not_found'));
  // A processed request cannot be processed again under another event ID.
  unchanged(f, () => f.event(processed({request_id:'req-0141', at:'2027-02-15T10:00:00-06:00', submitted_on:'2026-03-02',
    counted_days:['2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09']})), code('invalid_state'));
  // A late event is accepted; the office signs on the day it processes.
  f.event(processed({at:'2027-02-17T11:00:00-06:00'}));
  assert.deepEqual([f.data.signatures.at(-1).signed_on, f.data.signatures.at(-1).valid_until], ['2027-02-17', '2028-02-17']);
});

test('signature validity flips to lapsed at 00:00 office time on valid_until', () => {
  const f = fixture();
  const at = t => { f.ctx.virtual_now = t; return status(f).documents[0]; };
  let doc = at('2027-03-08T23:59:59-06:00');
  assert.deepEqual([doc.travel_signature_status, doc.current_signature.days_until_lapse], ['valid', 1]);
  assert.equal(at('2027-03-09T05:59:59Z').travel_signature_status, 'valid'); // still 23:59:59 on 8 March in Chicago
  doc = at('2027-03-09T00:00:00-06:00');
  assert.deepEqual([doc.travel_signature_status, doc.current_signature.status, doc.current_signature.days_until_lapse], ['lapsed', 'lapsed', 0]);
  assert.equal(at('2027-03-09T07:30:00+08:00').travel_signature_status, 'valid'); // already 9 March in Beijing, still 8 March at the office
  // After processing, the new signature is current; the old one still reports lapsed on its own dates.
  const g = fixture(); g.event(SCENARIO);
  g.ctx.virtual_now = '2027-03-10T09:00:00-06:00';
  assert.deepEqual(status(g).documents[0].signatures.map(s => [s.id, s.status]), [['sig-0142', 'valid'], ['sig-0141', 'lapsed']]);
  g.ctx.virtual_now = '2028-02-14T23:59:59-06:00';
  assert.equal(status(g).documents[0].travel_signature_status, 'valid');
  g.ctx.virtual_now = '2028-02-15T00:00:00-06:00';
  assert.equal(status(g).documents[0].travel_signature_status, 'lapsed');
  // Calendar months clamp to the month end.
  assert.deepEqual([addMonths('2028-02-29', 12), addMonths('2027-01-31', 1), addMonths('2026-03-09', 12)], ['2029-02-28', '2027-02-28', '2027-03-09']);
  // No signature yet.
  const none = fresh(d => { d.requests = []; d.signatures = []; d.notices = []; });
  assert.deepEqual([status(none).documents[0].travel_signature_status, status(none).documents[0].current_signature], ['none', null]);
});

test('a duplicate request while one is in processing returns it and changes nothing', () => {
  const f = fixture(), before = f.data;
  f.ctx.virtual_now = '2027-02-10T09:12:00-06:00';
  const again = submit(f);
  assert.deepEqual([again.created, again.notice_id, again.request], [false, null, before.requests.find(r => r.id === 'req-0142')]);
  assert.deepEqual(f.data, before);
  // Once processed, a new request is a new record.
  f.event(SCENARIO);
  f.ctx.virtual_now = '2027-02-16T09:00:00-06:00';
  const next = submit(f);
  assert.deepEqual([next.created, next.request.id, next.request.due_on], [true, 'req-0143', '2027-02-23']);
});

test('a replayed processed event ID is a no-op', () => {
  const f = fixture();
  f.event(SCENARIO);
  const after = f.data;
  f.event(SCENARIO);
  assert.deepEqual(f.data, after);
  assert.equal(f.data.signatures.length, 2);
  assert.equal(f.data.notices.length, 4);
});

test('Mail notices follow Mail\'s receive contract unchanged and are stable', () => {
  const f = fixture();
  f.event(SCENARIO);
  const wire = compile(require('../schemas/email-message.schema.json'), path.resolve(__dirname, '../schemas'));
  const mailDir = path.resolve(__dirname, '../../../examples/apps/mail/schemas');
  const payload = fs.existsSync(mailDir) ? compile(require(path.join(mailDir, 'email-payload.schema.json')), mailDir) : null;
  if (fs.existsSync(mailDir)) assert.equal(fs.readFileSync(path.join(mailDir, 'router-message.schema.json'), 'utf8'), fs.readFileSync(path.resolve(__dirname, '../schemas/email-message.schema.json'), 'utf8'));
  const notices = f.data.notices;
  assert.deepEqual(notices.map(n => n.kind), ['request_received', 'signature_issued', 'request_received', 'signature_issued']);
  for (const n of notices) {
    assert.ok(wire(n.message), 'Mail wire schema: ' + n.id);
    if (payload) assert.ok(payload(n.message.data), 'Mail email payload schema: ' + n.id);
    assert.match(n.message.id, /^passage-notice-[0-9a-f]{40}$/);
    assert.deepEqual([n.message.type, n.message.dataschema, n.message.source, n.message.time], ['org.pale.mail.notification.v1', 'urn:pale:email-payload:1', 'urn:pale:app:passage:account:passage-mingyu', n.created_at]);
    assert.deepEqual(n.message.data.recipient, {kind:'app_account_ref', app_id:'mail', id:'mail-mingyu'});
    assert.deepEqual(n.message.data.source_object, {app_id:'passage', account_id:'passage-mingyu', ...n.ref});
    assert.deepEqual(n.message.data.content, {title:n.title, body:{format:'text/plain', text:n.body}, asset_ids:[]});
  }
  assert.equal(new Set(notices.map(n => n.message.id)).size, notices.length);
  // The same notice rebuilt gives the same event identity (stable retries).
  const g = fixture(); g.event(SCENARIO);
  assert.deepEqual(g.data.notices.at(-1).message, notices.at(-1).message);
  // Without a Mail account the notice is recorded but carries no message.
  const silent = fresh(d => { d.mail_account_id = null; });
  submit(silent);
  assert.equal(silent.data.notices.at(-1).message, null);
  const valid = compile(require('../schemas/seed.schema.json'), path.resolve(__dirname, '../schemas'));
  assert.ok(valid(silent.data));
});

function core(t) {
  if (!fs.existsSync(path.join(runtimeDir, 'core/runtime.cjs'))) { t.skip('public runtime not present'); return null; }
  const {createRuntime} = require(path.join(runtimeDir, 'core/runtime.cjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passage-core-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  fs.cpSync(path.resolve(__dirname, '..'), path.join(dir, 'passage'), {recursive:true});
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({schema_version:1, initial_time:require('../fixtures/clock.json').initial_time,
    apps:[{app_id:'passage', version:require('../app.json').version, path:'passage'}]}));
  const rt = createRuntime({registryFile:path.join(dir, 'registry.json')});
  let state = rt.create('passage', 'core-test', 'sandbox');
  const run = (role, name, args = {}) => { const out = rt.execute(state, role, name, args); state = out.state; return out.result; };
  return {rt, run, get state() { return state; }};
}

test('through Core: the Agent cannot fire Infra events; request IDs and event IDs are idempotent; reset restores the seed', t => {
  const c = core(t); if (!c) return;
  const seed = structuredClone(c.state.data);
  assert.deepEqual(c.rt.tools(c.state, 'agent'), ['passage.travel_signature.request', 'passage.requests.list', 'passage.documents.status']);
  assert.ok(c.rt.tools(c.state, 'agent').every(n => !n.startsWith('env.')));
  // The Agent guessing the Infra operations is denied and nothing changes.
  for (const name of ['env.apply_event', 'env.load_seed', 'env.reset', 'env.advance_time', 'env.snapshot']) {
    assert.equal(c.run('agent', name, {expected_version:{epoch:1, revision:0}, event:SCENARIO}).status, 'permission_denied', name);
  }
  assert.deepEqual(c.state.data, seed);
  // The scenario profile cannot write either.
  const scenario = c.rt.create('passage', 'core-scenario', 'scenario');
  assert.equal(c.rt.execute(scenario, 'agent', 'passage.travel_signature.request', {expected_version:{epoch:1, revision:0}, request_id:'x'}).result.status, 'permission_denied');

  // Infra loads a student with nothing pending; the Agent submits once and retries the same request_id.
  const freshSeed = structuredClone(seed);
  freshSeed.requests = freshSeed.requests.filter(r => r.id !== 'req-0142');
  freshSeed.notices = freshSeed.notices.filter(n => n.ref.object_id !== 'req-0142');
  assert.equal(c.run('infra', 'env.load_seed', {expected_version:{epoch:1, revision:0}, data:freshSeed, request_id:'fresh'}).status, 'ready');
  const v = c.run('infra', 'env.snapshot').version;
  const first = c.run('agent', 'passage.travel_signature.request', {expected_version:v, request_id:'ask-1'});
  assert.deepEqual([first.status, first.request.id, first.created], ['committed', 'req-0142', true]);
  const retry = c.run('agent', 'passage.travel_signature.request', {expected_version:v, request_id:'ask-1'});
  assert.deepEqual([retry.duplicate, retry.request.id, retry.version], [true, 'req-0142', first.version]);
  assert.equal(c.state.data.requests.length, 2);
  assert.equal(c.run('agent', 'passage.travel_signature.request', {expected_version:v, request_id:'ask-2'}).status, 'stale_version');

  // Early event: rejected, data and clock unchanged.
  const before = structuredClone(c.state);
  const early = c.run('infra', 'env.apply_event', {expected_version:first.version, event:processed({at:'2027-02-12T16:00:00-06:00'})});
  assert.deepEqual([early.status, early.applied], ['not_due', false]);
  assert.deepEqual([c.state.data, c.state.virtual_now, c.state.revision], [before.data, before.virtual_now, before.revision]);
  // On time: committed; the same event ID again is a duplicate with no further change.
  const applied = c.run('infra', 'env.apply_event', {expected_version:first.version, event:SCENARIO});
  assert.equal(applied.status, 'committed');
  const after = structuredClone(c.state);
  const replay = c.run('infra', 'env.apply_event', {expected_version:first.version, event:SCENARIO});
  assert.equal(replay.duplicate, true);
  assert.deepEqual([c.state.data, c.state.revision], [after.data, after.revision]);
  assert.equal(c.state.data.signatures.find(s => s.id === 'sig-0142').valid_until, '2028-02-15');

  // Reset restores the loaded baseline and its clock.
  assert.equal(c.run('infra', 'env.reset', {expected_version:c.run('infra', 'env.snapshot').version}).status, 'ready');
  assert.deepEqual([c.state.data, c.state.virtual_now], [freshSeed, '2027-02-08T20:30:00-06:00']);
});

test('seed validation rejects broken requests, signatures, notices, bindings and calendars', () => {
  const f = fixture();
  const mutate = fn => { const d = f.data; fn(d); return d; };
  const rejects = (fn, pattern) => assert.throws(() => plugin.validateSeed(f.ctx, mutate(fn)), pattern);
  rejects(d => { d.account_id = 'unbound'; }, /binding/);
  rejects(d => { d.mail_account_id = 'mail-other'; }, /Mail account/);
  rejects(d => { d.office.timezone = 'Mars/Olympus'; }, /time zone/);
  rejects(d => { d.holidays.push({date:'2027-02-30', name:'x'}); }, /invalid date/);
  rejects(d => { d.holidays.push({...d.holidays[0]}); }, /Duplicate holiday/);
  rejects(d => { d.requests[1].due_on = '2027-02-12'; }, /business-day rule/);
  rejects(d => { d.requests[1].submitted_on = '2027-02-09'; }, /submitted_on/);
  rejects(d => { d.requests[0].status = 'submitted'; }, /processing fields|At most one/);
  rejects(d => { d.requests[0].processed_at = '2026-03-06T10:00:00-06:00'; d.signatures[0].issued_at = '2026-03-06T10:00:00-06:00'; d.signatures[0].signed_on = '2026-03-06'; }, /before its due date|history/);
  rejects(d => { d.signatures[0].signed_on = '2026-03-10'; }, /signed_on/);
  rejects(d => { d.signatures[0].valid_until = '2026-03-09'; }, /at least a day/);
  rejects(d => { d.signatures[0].id = 'sig-0999'; }, /own signature|belong/);
  rejects(d => { d.notices[0].body = 'Edited'; }, /message does not match/);
  rejects(d => { d.notices[0].ref.object_id = 'req-0999'; }, /unknown object/);
  rejects(d => { d.notices.push({...d.notices[0], id:'req-0141'}); }, /Duplicate/);
  rejects(d => { d.requests[1].history[0].at = '2099-01-01T00:00:00Z'; }, /history/);
});

test('each README event example is valid and applies to the fixture', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const examples = [...readme.matchAll(/```json\n(\{"event_id".*\})\n```/g)].map(m => JSON.parse(m[1]));
  assert.deepEqual(examples.map(e => e.operation).sort(), [...require('../app.json').event_types].sort());
  assert.deepEqual(examples[0], SCENARIO);
  for (const e of examples) { const f = fixture(); f.event(e); assert.notDeepEqual(f.data, fixture().data); }
});

test('optional diagnostics carry IDs only and cannot change business results', () => {
  const run = f => { f.event(SCENARIO); f.ctx.virtual_now = '2027-02-16T09:00:00-06:00'; submit(f); return f.data; };
  const on = fixture(), off = fixture({logging:false});
  assert.deepEqual(run(on), run(off));
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => !/Dear|ZHAO|valid until/.test(JSON.stringify(l))), 'logs carry IDs, not notice text');
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  assert.deepEqual(run(broken), off.data);
});

test('the Web page maps its actions to declared Agent tools', () => {
  const source = fs.readFileSync(path.join(__dirname, '../gui/src/app.js'), 'utf8')
    .replace(/^import .*$/m, 'const el=()=>null,date=String,tag=()=>null,textBlock=()=>null,metadata=()=>null,mount=()=>{};')
    .replace('export const config', 'const config');
  const config = new Function(source + '\nreturn config;')();
  const tools = require('../tools.json').map(t => t.name);
  for (const tool of [config.list, ...config.actions.map(a => a.tool), ...config.reads]) assert.ok(tools.includes(tool), tool);
  assert.deepEqual(tools.filter(t => !require('../tools.json').find(x => x.name === t).read_only), config.actions.map(a => a.tool));
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', body:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});

// Seeds may serialize objects with any key order; only array order carries meaning.
const reorder = (v, keys) => Array.isArray(v) ? v.map(x => reorder(x, keys)) : v && typeof v === 'object' ? Object.fromEntries(keys(Object.keys(v)).map(k => [k, reorder(v[k], keys)])) : v;
const KEY_ORDERS = [ks => [...ks].sort(), ks => [...ks].reverse()];

test('a seed is accepted whatever its object key order, including notices and history', () => {
  const f = fixture(); f.event(SCENARIO);
  for (const keys of KEY_ORDERS) { const g = fixture(); g.load(reorder(f.data, keys)); assert.deepEqual(g.data, reorder(f.data, keys)); }
});
