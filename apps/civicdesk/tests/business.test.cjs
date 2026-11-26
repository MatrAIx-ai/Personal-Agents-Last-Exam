'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const T = 'civicdesk.';
function unchanged(f, fn, pattern) {const before = f.data; assert.throws(fn, pattern); assert.deepEqual(f.data, before);}
const code = (fn, expected) => {try {fn(); assert.fail('expected ' + expected);} catch (e) {assert.equal(e.code, expected, e.message); return e.message;}};
const ev = (event_id, at, operation, payload) => ({event_id, at, operation, payload});
const ANON = {kind:'anonymous', name:null, organization:null}, NAMED = {kind:'named', name:'Dana Reyes', organization:null};
const TEXT = 'Retention should be opt-in and end with the episode of care: I have never needed a patient\'s step or heart-rate data more than twelve months after discharge. De-identified sensor streams can be re-identified in a small town. Small clinics need a clear deletion path when care ends; thirty days would work for us.';

test('standalone seed: reads describe the fixture and change nothing', () => {
  const f = fixture(), before = f.data;
  const open = f.call(T + 'dockets.search', {status:'open'}).dockets;
  assert.equal(open.length, 7); assert.ok(open.every(d => d.status === 'open' && d.days_left > 0));
  assert.equal(open[0].id, 'OCDD-2026-0031');                                   // the soonest closing comes first
  const target = f.call(T + 'dockets.get', {id:'OCDD-2026-0031'}).docket;
  assert.equal(target.closes_at, '2026-12-04T23:59:00-05:00'); assert.equal(target.agency.timezone, 'America/New_York'); assert.ok(target.closes_at_local.includes('EST'));
  assert.equal(target.closing_soon, true); assert.equal(target.days_left, 5);   // 4.1 days away, rounded up assert.equal(target.documents.length, 2); assert.deepEqual(target.my_comment_ids, []);
  const decoy = f.call(T + 'dockets.get', {id:'OCDD-2026-0027'}).docket;
  assert.equal(decoy.closes_at, '2026-12-18T23:59:00-05:00'); assert.equal(decoy.closing_soon, false);
  assert.equal(f.call(T + 'dockets.search', {query:'wearable'}).dockets.filter(d => d.status !== 'closed').length, 3);
  assert.ok(f.call(T + 'dockets.search', {agency_id:'ools', status:'closed'}).dockets.every(d => d.agency.acronym === 'OOLS' && d.status === 'closed'));
  assert.equal(f.call(T + 'dockets.search', {closing_after:'2026-12-01', closing_before:'2026-12-31', status:'open'}).dockets.length, 4);
  const docs = f.call(T + 'dockets.documents', {id:'OCDD-2026-0031'}).documents;
  assert.equal(docs.length, 2); assert.ok(docs.every(x => crypto.createHash('sha256').update(Buffer.from(x.file.base64, 'base64')).digest('hex') === x.file.sha256));
  assert.ok(docs.some(x => x.mime_type === 'application/pdf' && Buffer.from(x.file.base64, 'base64').subarray(0, 5).toString() === '%PDF-'));
  assert.ok(Buffer.from(docs[0].file.base64, 'base64').toString('utf8').includes('DATES: Comments must be received on or before 2026-12-04 at 11:59 PM America/New_York'));
  const mine = f.call(T + 'comments.list_mine', {});
  assert.equal(mine.drafts.length, 0); assert.equal(mine.comments.length, 3); assert.equal(mine.comments[0].id, 'cmt-h003'); assert.equal(mine.comments[0].status, 'received');
  assert.equal(f.call(T + 'comments.list_mine', {status:'posted'}).comments.length, 2);
  const receipt = f.call(T + 'comments.receipt', {id:'cmt-h001'}).receipt;
  assert.ok(receipt.tracking_number.startsWith('CDK-2025-0004-') && receipt.submitted_at_local.includes('CDT'));
  assert.equal(f.call(T + 'comments.status', {id:'cmt-h001'}).comment.status, 'posted');
  assert.ok(before.dockets.some(d => d.opened_at < '2025-02-01'), 'history starts in January 2025');
  unchanged(f, () => f.call(T + 'dockets.get', {id:'OCDD-2099-0001'}), /does not exist/);
  assert.deepEqual(f.data, before);
});

test('validateSeed rejects dangling documents, reversed periods, mismatched hashes and duplicate IDs', () => {
  const f = fixture();
  const broken = mutate => {const d = f.data; mutate(d); return () => plugin.validateSeed(f.ctx, d);};
  assert.throws(broken(d => {d.documents[0].docket_id = 'OCDD-2099-0001';}), /unknown docket/);
  assert.throws(broken(d => {d.dockets[0].closes_at = d.dockets[0].opened_at;}), /closes before it opens/);
  assert.throws(broken(d => {d.comments[0].text = d.comments[0].text + ' changed';}), /text_sha256/);
  assert.throws(broken(d => {d.dockets[1].docket_id = d.dockets[0].docket_id;}), /Duplicate ID/);
  assert.throws(broken(d => {d.comments[0].status = 'returned';}), /returned comments carry a reason/);
  unchanged(f, () => f.call(T + 'comments.validate', {docket_id:'OCDD-2026-0031', text:TEXT, submitter:{kind:'secret'}}), /Input schema/);
});

test('validate and draft report problems without submitting; a named draft needs a name', () => {
  const f = fixture();
  const ok = f.call(T + 'comments.validate', {docket_id:'OCDD-2026-0031', text:TEXT, submitter:ANON});
  assert.equal(ok.ok, true); assert.deepEqual(ok.problems, []); assert.equal(ok.docket_status, 'open'); assert.ok(ok.closes_at_local.includes('Dec 4, 2026'));
  const short = f.call(T + 'comments.validate', {docket_id:'OCDD-2026-0031', text:'Too short.', submitter:{kind:'named', name:null, organization:null}});
  assert.deepEqual(short.problems.map(p => p.code), ['too_short', 'name_required']);
  const closed = f.call(T + 'comments.validate', {docket_id:'BSBR-2025-0004', text:TEXT, submitter:ANON});
  assert.deepEqual(closed.problems.map(p => p.code), ['period_closed', 'possible_duplicate']);
  const d = f.call(T + 'comments.draft', {docket_id:'OCDD-2026-0031', text:'Too short.', submitter:{kind:'named', name:null, organization:null}});
  assert.equal(d.ready, false); assert.deepEqual(d.problems.map(p => p.code), ['too_short', 'name_required']);
  assert.equal(f.call(T + 'comments.list_mine', {}).drafts[0].id, d.id);
  assert.equal(f.call(T + 'dockets.get', {id:'OCDD-2026-0031'}).docket.my_draft_id, d.id);
  const fixed = f.call(T + 'comments.draft', {id:d.id, docket_id:'OCDD-2026-0031', text:TEXT, submitter:ANON});
  assert.equal(fixed.ready, true); assert.equal(fixed.id, d.id);
  assert.deepEqual(f.call(T + 'comments.list_mine', {}).drafts[0].submitter, ANON);
  code(() => f.call(T + 'comments.draft', {id:d.id, docket_id:'OCDD-2026-0027', text:TEXT, submitter:ANON}), 'invalid_arguments');
  code(() => f.call(T + 'comments.draft', {docket_id:'OCDD-2099-0001', text:TEXT, submitter:ANON}), 'unknown_docket');
});

test('submit: the acknowledgment gate, the receipt, idempotent resubmission, and the duplicate and closed-period refusals', () => {
  const f = fixture();
  const d = f.call(T + 'comments.draft', {docket_id:'OCDD-2026-0031', text:TEXT, submitter:ANON});
  unchanged(f, () => f.call(T + 'comments.submit', {id:d.id, acknowledged:false}), /acknowledge/);
  assert.equal(code(() => f.call(T + 'comments.submit', {id:d.id, acknowledged:false}), 'acknowledgment_required').includes('Nothing was submitted'), true);
  const s = f.call(T + 'comments.submit', {id:d.id, acknowledged:true});
  assert.equal(s.outcome, 'received'); assert.ok(s.tracking_number.startsWith('CDK-2026-0031-'));
  const receipt = f.call(T + 'comments.receipt', {id:s.id}).receipt;
  assert.equal(receipt.tracking_number, s.tracking_number); assert.equal(receipt.submitter.kind, 'anonymous'); assert.equal(receipt.text_sha256, crypto.createHash('sha256').update(TEXT).digest('hex'));
  assert.ok(receipt.submitted_at_local.includes('EST'));
  assert.equal(f.call(T + 'comments.list_mine', {}).drafts.length, 0);
  assert.deepEqual(f.call(T + 'dockets.get', {id:'OCDD-2026-0031'}).docket.my_comment_ids, [s.id]);
  unchanged(f, () => f.call(T + 'comments.submit', {id:d.id, acknowledged:true}), /does not exist/);           // the draft was consumed
  const again = f.call(T + 'comments.draft', {docket_id:'OCDD-2026-0031', text:TEXT + ' Also, please publish the deletion timeline.', submitter:ANON});
  assert.deepEqual(again.problems.map(p => p.code), ['possible_duplicate']);
  assert.ok(code(() => f.call(T + 'comments.submit', {id:again.id, acknowledged:true}), 'possible_duplicate').includes(s.id));
  const supplemental = f.call(T + 'comments.draft', {id:again.id, docket_id:'OCDD-2026-0031', text:TEXT + ' Also, please publish the deletion timeline.', submitter:ANON, supplemental:true});
  assert.equal(supplemental.ready, true);
  assert.equal(f.call(T + 'comments.submit', {id:supplemental.id, acknowledged:true}).outcome, 'received');
  assert.equal(f.call(T + 'comments.list_mine', {}).comments.filter(c => c.docket_id === 'OCDD-2026-0031' && c.supplemental).length, 1);
  const late = f.call(T + 'comments.draft', {docket_id:'OCDD-2026-0027', text:TEXT, submitter:NAMED});
  f.ctx.virtual_now = '2026-12-19T08:00:00-05:00';
  assert.ok(code(() => f.call(T + 'comments.submit', {id:late.id, acknowledged:true}), 'period_closed').includes('Dec 18, 2026'));
  assert.equal(f.call(T + 'comments.list_mine', {}).drafts[0].docket_status, 'closed');
  const g = fixture();
  const bad = g.call(T + 'comments.draft', {docket_id:'OCDD-2026-0031', text:'Too short.', submitter:NAMED});
  assert.ok(code(() => g.call(T + 'comments.submit', {id:bad.id, acknowledged:true}), 'invalid_draft').includes('characters'));
});

test('events: an extension moves the closing, a correction leaves comments unchanged, status and notice records', () => {
  const f = fixture();
  const d = f.call(T + 'comments.draft', {docket_id:'OCDD-2026-0031', text:TEXT, submitter:ANON});
  const s = f.call(T + 'comments.submit', {id:d.id, acknowledged:true});
  f.event(ev('evt-6001', '2026-12-02T09:00:00-05:00', 'docket.period_extended', {docket_id:'OCDD-2026-0031', new_closes_at:'2026-12-18T23:59:00-05:00', reason:'Extended at the request of commenters'}));
  const docket = f.call(T + 'dockets.get', {id:'OCDD-2026-0031'}).docket;
  assert.equal(docket.status, 'extended'); assert.equal(docket.extended_from, '2026-12-04T23:59:00-05:00'); assert.equal(docket.closes_at, '2026-12-18T23:59:00-05:00'); assert.equal(docket.days_left, 17);
  assert.equal(f.call(T + 'comments.list_mine', {}).comments.filter(c => c.docket_id === 'OCDD-2026-0031').length, 1, 'an extension creates no second comment');
  unchanged(f, () => f.event(ev('evt-6002', '2026-12-02T09:01:00-05:00', 'docket.period_extended', {docket_id:'OCDD-2026-0031', new_closes_at:'2026-12-10T23:59:00-05:00'})), /later than/);
  f.event(ev('evt-6003', '2026-12-09T10:00:00-05:00', 'docket.correction_published', {docket_id:'OCDD-2026-0031', text:'Correction: the proposed retention period in section 3 is 36 months, not three years.'}));
  assert.equal(f.call(T + 'dockets.get', {id:'OCDD-2026-0031'}).docket.corrections.length, 1);
  assert.equal(f.call(T + 'comments.status', {id:s.id}).comment.text_sha256, crypto.createHash('sha256').update(TEXT).digest('hex'), 'a correction leaves the comment unchanged');
  f.event(ev('evt-6004', '2026-12-10T11:00:00-05:00', 'comment.status_changed', {comment_id:s.id, status:'posted'}));
  assert.equal(f.call(T + 'comments.status', {id:s.id}).comment.status, 'posted');
  unchanged(f, () => f.event(ev('evt-6005', '2026-12-10T11:01:00-05:00', 'comment.status_changed', {comment_id:s.id, status:'returned', reason:'late'})), /already posted/);
  unchanged(f, () => f.event(ev('evt-6006', '2026-12-10T11:02:00-05:00', 'comment.status_changed', {comment_id:'cmt-h003', status:'returned'})), /needs the agency/);
  f.event(ev('evt-6007', '2026-12-10T11:03:00-05:00', 'comment.status_changed', {comment_id:'cmt-h003', status:'returned', reason:'The comment addresses a different docket.'}));
  assert.equal(f.call(T + 'comments.status', {id:'cmt-h003'}).comment.return_reason, 'The comment addresses a different docket.');
  f.event(ev('evt-6008', '2026-12-10T11:04:00-05:00', 'comment.notice_recorded', {comment_id:s.id, kind:'receipt', status:'rejected', event_id:null}));
  f.event(ev('evt-6009', '2026-12-10T11:05:00-05:00', 'comment.notice_recorded', {comment_id:s.id, kind:'status', status:'delivered', event_id:'router-abc'}));
  const notices = f.call(T + 'comments.status', {id:s.id}).comment.notices;
  assert.deepEqual(notices.map(n => [n.kind, n.status]), [['receipt', 'rejected'], ['status', 'delivered']]);
  unchanged(f, () => f.event(ev('evt-6010', '2026-12-10T12:00:00-05:00', 'nope.operation', {})), /Event schema/);
});

test('periods close by the clock in the agency\'s time zone, not by an event', () => {
  const f = fixture();
  f.ctx.virtual_now = '2026-12-04T20:30:00-08:00';                       // 11:30 PM Eastern on the closing day: still open
  assert.equal(f.call(T + 'dockets.get', {id:'OCDD-2026-0031'}).docket.status, 'open');
  f.ctx.virtual_now = '2026-12-04T21:30:00-08:00';                       // 12:30 AM Eastern the next day: closed
  assert.equal(f.call(T + 'dockets.get', {id:'OCDD-2026-0031'}).docket.status, 'closed');
  assert.equal(f.call(T + 'dockets.search', {status:'open'}).dockets.some(d => d.id === 'OCDD-2026-0031'), false);
  const d = f.call(T + 'comments.draft', {docket_id:'OCDD-2026-0031', text:TEXT, submitter:ANON});
  assert.deepEqual(d.problems.map(p => p.code), ['period_closed']);
});

test('notices: each kind builds a valid, deterministic Mail wire message from public views only', () => {
  const {compile} = require('./schema-validator.cjs');
  const dir = path.resolve(__dirname, '../schemas');
  const wire = compile(require('../schemas/router-message.schema.json'), dir), payload = compile(require('../schemas/email-payload.schema.json'), dir);
  const notices = require('../src/notices.cjs');
  const f = fixture(), bind = {account:'acct-dana', person:'person-dana'};
  const s = f.call(T + 'comments.submit', {id:f.call(T + 'comments.draft', {docket_id:'OCDD-2026-0031', text:TEXT, submitter:ANON}).id, acknowledged:true});
  f.event(ev('evt-6020', '2026-12-10T11:00:00-05:00', 'comment.status_changed', {comment_id:s.id, status:'posted'}));
  const views = {receipt:{receipt:f.call(T + 'comments.receipt', {id:s.id}).receipt}, status:{comment:f.call(T + 'comments.status', {id:s.id}).comment}};
  assert.deepEqual(Object.keys(views).sort(), [...notices.KINDS].sort());
  for (const kind of notices.KINDS) {
    const m = notices.build(kind, views[kind], bind);
    assert.ok(wire(m), kind + ': wire message'); assert.ok(payload(m.data), kind + ': payload');
    assert.deepEqual(notices.build(kind, views[kind], bind), m, kind + ': deterministic');
    assert.equal(m.source, 'urn:pale:app:civicdesk:account:acct-dana'); assert.deepEqual(m.data.recipient, {kind:'person_ref', id:'person-dana'});
  }
  const r = notices.build('receipt', views.receipt, bind);
  assert.equal(r.id, 'civicdesk-notice-receipt-' + s.id); assert.ok(r.data.content.body.text.includes(s.tracking_number) && r.data.content.body.text.includes('anonymous'));
  assert.throws(() => notices.build('status', {comment:{...views.status.comment, status:'received'}}, bind), /no status change/);
  assert.throws(() => notices.build('nope', views.receipt, bind), /Unknown notice kind/);
});

test('optional diagnostics cannot change business results', () => {
  const on = fixture(), off = fixture({logging:false});
  const scenario = require('../examples/scenario.json');
  on.event(scenario); off.event(scenario); assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => l.step.startsWith('civicdesk.')));
  const broken = fixture(); broken.ctx.log = () => {throw Error('logger offline');};
  broken.event(scenario); assert.deepEqual(broken.data, off.data);
});

test('generated contract files match scripts/contracts.cjs', () => {
  require('../scripts/build.cjs').build({check:true});
  const tools = require('../tools.json');
  assert.equal(tools.length, 9); assert.equal(tools.filter(t => t.read_only).length, 7);
  assert.ok(tools.every(t => t.name.startsWith('civicdesk.')));
  assert.ok(tools.filter(t => !t.read_only).every(t => t.inputSchema.required.includes('expected_version') && t.inputSchema.required.includes('request_id')));
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', text:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});
