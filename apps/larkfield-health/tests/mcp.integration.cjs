'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.lastIndexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const appDir = path.resolve(__dirname, '..');
const runtimeDir = path.resolve(option('--runtime', process.env.PALE_RUNTIME_ROOT || path.join(appDir, '..', '..', 'runtime')));
const reportFile = option('--report', null);
const { prepare } = require(path.join(runtimeDir, 'prepare.cjs'));
const { Client } = require(path.join(runtimeDir, 'client.cjs'));
const S = require('./seeds.cjs');
const plugin = require('../plugin.cjs');

const P = 'larkfield-health.';
const checks = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push({ name, status: 'passed' }); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, status: 'passed' }); };
const NOW = '2026-11-18T12:00:00-05:00', REVIEW = '2026-11-21T23:59:00-05:00', AFTER_REVIEW = '2026-11-22T09:00:00-05:00', EXPIRY = '2027-01-05T23:59:00-05:00', PA_DUE = '2026-12-01T23:59:00-05:00';
const attest = (s, member, year) => { Object.assign(s.coverage.find(c => c.member_id === member && c.plan_year === year), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' }); return s; };
const withClaim = (s, claim_id, member_id, lines, provider_id = 'pv-1', received_at = NOW) => { S.claim(s, { claim_id, member_id, provider_id, received_at, lines }); return S.finalize(s); };
const office = (id = 'ln-1', position = 1) => S.line(id, position, 'svc-office-visit', '2026-11-17', 21000);
const intake = (claim_id, line) => ({ claim_id, member_id: 'm-1', provider_id: 'pv-2', lines: [line] });
const live = (line_id, service_id, service_date, billed_cents) => ({ line_id, service_id, service_date, units: 1, billed_cents, emergency: false, possible_accident: false });
const C = (x, id) => x.claims.find(c => c.claim_id === id), V = (x, id, v = 1) => x.eobs.find(e => e.claim_id === id && e.version === v);
const appended = (before, after) => after.snapshot.data.notices.slice(before.snapshot.data.notices.length).map(n => [n.kind, n.recipient_id, n.subject.id, n.at]);

async function main() {
  const prepared = prepare(appDir);
  const clients = [];
  const open = async (role, run) => {
    const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'larkfield-mcp-check', { registry: prepared.registry });
    clients.push(c);
    await c.initialize();
    return c;
  };
  const session = async (run, seed, at = NOW) => {
    const infra = await open('infra', run), agent = await open('agent', run);
    let n = 0;
    const snap = () => infra.call('env.snapshot');
    const version = async () => (await snap()).version;
    const data = async () => (await snap()).snapshot.data;
    const read = (name, args = {}) => agent.call(P + name, args);
    const write = async (name, args, id) => agent.call(P + name, { ...args, request_id: id || run + '-w' + (++n), expected_version: await version() });
    const event = async (operation, payload, when, id) => infra.call('env.apply_event', { expected_version: await version(), event: { event_id: id || run + '-e' + (++n), at: when || (await snap()).snapshot.virtual_now, operation, payload } });
    const nudge = (when, id) => event('user.confirmed', { token: 'tok-unrelated', confirmed_by: 'm-1' }, when, id);
    const advance = async when => { const out = await infra.call('env.advance_time', { expected_version: await version(), virtual_now: when, request_id: run + '-t' + (++n) }); assert.equal(out.status, 'committed', run + ' advance to ' + when + ': ' + JSON.stringify(out)); return out; };
    const load = async (next, id, when = at) => infra.call('env.load_seed', { expected_version: await version(), data: next, virtual_now: when, request_id: run + '-' + id });
    const approve = async (op, args) => {
      const pv = await read(op + '.preview', args);
      assert.equal(pv.status, 'ok', run + ' ' + op + ' preview: ' + JSON.stringify(pv));
      assert.equal((await event('user.confirmed', { token: pv.preview.token, confirmed_by: pv.preview.required_confirmer })).status, 'committed');
      return pv.preview.token;
    };
    const settle = async (op, args) => {
      const out = await write(op + '.confirm', { ...args, token: await approve(op, args) });
      assert.equal(out.status, 'committed', run + ' ' + op + ' confirm: ' + JSON.stringify(out));
      return out;
    };
    const persisted = async (claimId, paId) => {
      const view = c => ({ status: c.status, lines: c.lines, eobs: c.eobs });
      const paView = async client => { if (!paId) return null; const { approvals, ...rest } = (await client.call(P + 'pa.get', { pa_id: paId })).pa; return rest; };
      const mark = d => { if (!paId) return null; const x = d.pas.find(q => q.pa_id === paId); return { status: x.status, units_used: x.units_used, approved_after_post: x.approved_after_post }; };
      const before = (await read('claims.get', { claim_id: claimId })).claim, pa = await paView(agent), stored = await snap();
      const fresh = await open('agent', run), freshInfra = await open('infra', run);
      const reopened = (await fresh.call(P + 'claims.get', { claim_id: claimId })).claim, reopenedPa = await paView(fresh), reopenedMark = mark((await freshInfra.call('env.snapshot')).snapshot.data);
      const reloaded = await infra.call('env.load_seed', { expected_version: stored.version, data: { ...stored.snapshot.data, approvals: [] }, virtual_now: stored.snapshot.virtual_now, request_id: run + '-reload-' + (++n) });
      const after = (await read('claims.get', { claim_id: claimId })).claim, afterPa = await paView(agent), afterMark = mark(await data());
      return { claim: before, pa, mark: mark(stored.snapshot.data), actual: [reopened, reopenedPa, reopenedMark, reloaded.status, view(after), afterPa, afterMark], expected: [before, pa, mark(stored.snapshot.data), 'ready', view(before), pa, mark(stored.snapshot.data)] };
    };
    const loaded = await infra.call('env.load_seed', { expected_version: await version(), data: seed, virtual_now: at, request_id: run + '-seed' });
    assert.equal(loaded.status, 'ready', run + ' seed loads: ' + JSON.stringify(loaded));
    return { infra, agent, snap, version, data, read, write, event, nudge, advance, load, approve, settle, persisted };
  };
  const denials = s => s.snapshot.audit.filter(x => x.decision !== 'allow').length;
  const delta = (before, after) => after.snapshot.audit.slice(before.snapshot.audit.length).map(x => [x.actor, x.tool, x.decision]);

  try {
    equal('The package wire schema is byte-identical to the runtime contract', fs.readFileSync(path.join(appDir, 'schemas/router-message.schema.json')), fs.readFileSync(path.join(runtimeDir, 'contracts/schemas/router-message.schema.json')));
    {
      const s = await session('t17-info', S.pendingCob('m-2', 2026, S.granted(S.base(), 'm-2', 'act'), true));
      const args = { claim_id: 'cl-4', line_id: 'ln-1', answer: 'not_accident' };
      const pv = await s.read('claims.info.preview', args);
      check('T17 [MCP] claims.info.preview on the open accident request returns a token for the bound account holder', pv.status === 'ok' && /^tok-info-request-ir-2-[0-9a-f]{32}$/.test(pv.preview.token) && pv.preview.required_confirmer === 'm-1');
      const before = await s.snap();
      const early = await s.agent.call(P + 'claims.info.confirm', { ...args, token: pv.preview.token, request_id: 't17-info-early', expected_version: before.version });
      equal('T17 [MCP] a confirm before user.confirmed is confirmation_required', early.status, 'confirmation_required');
      const after = await s.snap();
      equal('T17 [MCP] the refused confirm stores nothing and leaves one denial audit row', [after.snapshot.data, after.version, denials(after) - denials(before)], [before.snapshot.data, before.version, 1]);
      const confirmed = await s.event('user.confirmed', { token: pv.preview.token, confirmed_by: 'm-1' });
      equal('T17 [MCP] Infra applies user.confirmed for the token', confirmed.status, 'committed');
      const version = await s.version();
      const write = { ...args, token: pv.preview.token, request_id: 't17-info-confirm', expected_version: version };
      const done = await s.agent.call(P + 'claims.info.confirm', write);
      equal('T17 [MCP] claims.info.confirm with a fresh request ID and the current version commits', [done.status, done.claim.info_requests.find(r => r.info_request_id === 'ir-2').answer], ['committed', 'not_accident']);
      const stored = (await s.snap()).snapshot.data;
      equal('T17 [MCP] the request is answered and the approval used in stored data', [stored.info_requests.find(r => r.info_request_id === 'ir-2').status, stored.approvals.map(a => [a.approval_id, a.used_at !== null])], ['answered', [['cf-1', true]]]);
      const again = await s.agent.call(P + 'claims.info.confirm', write);
      const { duplicate, ...receipt } = again;
      equal('T19 [MCP] an exact replay returns the original receipt marked duplicate', [duplicate, receipt], [true, done]);
      equal('T19 [MCP] the replay stores nothing new', (await s.snap()).snapshot.data, stored);
      const b1 = await s.snap();
      const conflict = await s.agent.call(P + 'claims.info.confirm', { ...write, answer: 'accident' });
      const b2 = await s.snap();
      equal('T19 [MCP] the same request ID with changed input is idempotency_conflict, with one denial row and nothing stored', [conflict.status, delta(b1, b2), b2.snapshot.data, b2.version], ['idempotency_conflict', [['agent', P + 'claims.info.confirm', 'deny']], b1.snapshot.data, b1.version]);
      equal('T19 [MCP] an unknown claim is not_found', (await s.read('claims.get', { claim_id: 'cl-404' })).status, 'not_found');
      const envTools = ['env.load_seed', 'env.snapshot', 'env.advance_time', 'env.apply_event', 'env.reset', 'env.event_status', 'env.validate_bundle'];
      const listed = (await s.agent.request('tools/list')).result.tools.map(t => t.name);
      equal('T19 [MCP] the Agent calling any of the seven env tools is permission_denied, and none is in its tool list', [await Promise.all(envTools.map(async t => (await s.agent.call(t, {})).status)), envTools.filter(t => listed.includes(t))], [envTools.map(() => 'permission_denied'), []]);
    }
    {
      const s = await session('t14-review', withClaim(S.paPending(), 'cl-7', 'm-1', [S.line('ln-1', 1, 'svc-knee-mri', '2026-11-17', 180000, { possible_accident: true }), office('ln-2', 2)], 'pv-2'));
      const seeded = await s.snap();
      await s.advance(AFTER_REVIEW);
      const pending = (await s.read('claims.get', { claim_id: 'cl-7' })).claim;
      const pv = await s.read('claims.info.preview', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' });
      check('T14 [MCP] with no business event: env.advance_time past a claim\'s 3-day review, where the review opens an accident request → claims.get reports pending_info and claims.info.preview returns a token', pending.status === 'pending_info' && pv.status === 'ok' && /^tok-info-request-ir-1-[0-9a-f]{32}$/.test(pv.preview.token));
      await s.advance('2027-01-06T09:00:00-05:00');
      const claim = (await s.read('claims.get', { claim_id: 'cl-7' })).claim, pa = (await s.read('pa.get', { pa_id: 'pa-2' })).pa;
      equal('T14 [MCP] env.advance_time past that request\'s 45-day expiry and past an open PA\'s decision due date → claims.get reports the accident line denied missing_information and the claim processed with EOB v1, and pa.get reports overdue',
        [claim.status, claim.eobs.map(e => e.version), claim.lines.map(l => [l.outcome.status, l.outcome.reason]), pa.overdue], ['processed', [1], [['denied', 'missing_information'], ['paid', null]], true]);
      const raw = await s.snap();
      equal('T14 [MCP] while env.snapshot still shows the claim received, the PA without overdue and no new notice', [C(raw.snapshot.data, 'cl-7').status, raw.snapshot.data.pas[0].overdue, raw.snapshot.data.notices], ['received', false, seeded.snapshot.data.notices]);
      const committed = await s.event('user.confirmed', { token: pv.preview.token, confirmed_by: 'm-1' });
      const after = await s.snap(), d = after.snapshot.data;
      equal('T14 [MCP] a user.confirmed event for the earlier token then commits the review, the request, its expiry, the EOB, the postings and the overdue flag once, each dated at its due time',
        [committed.status, C(d, 'cl-7').processed_at, d.info_requests.map(r => [r.info_request_id, r.opened_at, r.status, r.request_version]), d.eobs.filter(e => e.claim_id === 'cl-7').map(e => [e.version, e.issued_at, e.postings]), d.pas[0].overdue_at, d.accumulators.find(a => a.member_id === 'm-1' && a.plan_year === 2026)],
        ['committed', EXPIRY, [['ir-1', REVIEW, 'expired', 1]], [[1, EXPIRY, [{ member_id: 'm-1', plan_year: 2026, deductible_cents: 0, oop_cents: 2500 }]]], PA_DUE, { member_id: 'm-1', plan_year: 2026, deductible_cents: 0, oop_cents: 5000 }]);
      equal('T14 [MCP] and their notices once, each dated at its due time', appended(raw, after),
        [['notice.info_requested', 'm-1', 'ir-1', REVIEW], ['notice.decision_overdue', 'm-1', 'pa-2', PA_DUE], ['notice.decision_overdue', 'm-2', 'pa-2', PA_DUE], ['notice.decision_overdue', 'm-3', 'pa-2', PA_DUE], ['notice.eob_available', 'm-1', 'cl-7', EXPIRY], ['notice.claim_denied', 'm-1', 'cl-7', EXPIRY]]);
      const stale = await s.write('claims.info.confirm', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident', token: pv.preview.token });
      const end = await s.snap();
      equal('T14 [MCP] claims.info.confirm with that token, a fresh request ID and the current expected_version → stale_preview with one denial audit row', [stale.status, delta(after, end), end.snapshot.data, end.version], ['stale_preview', [['agent', P + 'claims.info.confirm', 'deny']], after.snapshot.data, after.version]);
    }
    {
      const s = await session('t14-expiry', withClaim(S.base(), 'cl-7', 'm-1', [S.line('ln-1', 1, 'svc-knee-mri', '2026-11-17', 180000, { possible_accident: true })], 'pv-2'));
      await s.advance('2027-01-05T23:54:00-05:00');
      const args = { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' };
      const token = await s.approve('claims.info', args);
      check('T14 [MCP] a matching user.confirmed applied five minutes before a request\'s expiry', (await s.data()).approvals.some(a => a.token === token && a.confirmed_at === '2027-01-05T23:54:00-05:00'));
      await s.advance('2027-01-06T00:00:00-05:00');
      const before = await s.snap();
      const out = await s.write('claims.info.confirm', { ...args, token });
      const after = await s.snap();
      equal('T14 [MCP] env.advance_time to one minute after it and the same confirm → stale_preview', out.status, 'stale_preview');
      equal('T14 [MCP] with business data, notices and version identical across the rejected call and one new denial audit row', [after.snapshot.data, after.version, delta(before, after)], [before.snapshot.data, before.version, [['agent', P + 'claims.info.confirm', 'deny']]]);
    }
    {
      const s = await session('t12-noop', S.openAppeal(undefined, 'info_requested'));
      const before = await s.snap();
      const ev = { appeal_id: 'ap-1', request: 'A second copy of the referral' };
      const out = await s.event('appeal.info_requested', ev, undefined, 't12-again');
      const after = await s.snap();
      equal('T12 [MCP] a second appeal.info_requested while already info_requested is a committed no-op: unchanged appeal_version, no new notice, Core\'s revision advances once',
        [out.status, after.snapshot.data.appeals, after.snapshot.data.notices, after.version.revision - before.version.revision], ['committed', before.snapshot.data.appeals, before.snapshot.data.notices, 1]);
      const { duplicate, ...replay } = await s.event('appeal.info_requested', ev, after.snapshot.virtual_now, 't12-again');
      const later = await s.snap();
      equal('T12 [MCP] an exact replay returns the receipt and does not advance the revision', [duplicate, replay, later.version, later.snapshot.data], [true, out, after.version, after.snapshot.data]);
      assert.equal((await s.event('appeal.decided', { appeal_id: 'ap-1', outcome: 'upheld' })).status, 'committed');
      const closed = await s.snap();
      const late = await s.event('appeal.info_requested', ev);
      const end = await s.snap();
      equal('T12 [MCP] an appeal info event on a closed appeal is a committed no-op with one revision', [late.status, end.snapshot.data.appeals, end.snapshot.data.notices, end.version.revision - closed.version.revision], ['committed', closed.snapshot.data.appeals, closed.snapshot.data.notices, 1]);
    }
    {
      const minor = attest(S.base(), 'm-3', 2026);
      S.claim(minor, { claim_id: 'cl-6', member_id: 'm-3', provider_id: 'pv-5', received_at: '2026-11-13T11:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-12', 21000)] });
      S.window(minor, 'claim', 'cl-6', S.process(minor, 'cl-6', [S.denied('ln-1', 'out_of_network', 21000)]).issued_at);
      const s = await session('t14-due', S.openAppeal({ type: 'claim', id: 'cl-6' }, 'info_requested', S.finalize(minor)), '2027-01-10T09:00:00-05:00');
      const due = (await s.data()).appeals[0].due_at;
      const before = await s.snap();
      const ev = { event_id: 't14-due-info', at: due, operation: 'appeal.info_requested', payload: { appeal_id: 'ap-1', request: 'The provider\'s network letter' } };
      const out = await s.infra.call('env.apply_event', { expected_version: before.version, event: ev });
      const after = await s.snap(), a0 = before.snapshot.data.appeals[0], a1 = after.snapshot.data.appeals[0];
      equal('T14 [MCP] a second appeal.info_requested exactly at the appeal\'s due time: one overdue notice per recipient, no second request notice', [out.status, before.snapshot.data.appeals[0].member_id, appended(before, after)], ['committed', 'm-3', ['m-1', 'm-2', 'm-3'].map(r => ['notice.decision_overdue', r, 'ap-1', due])]);
      equal('T14 [MCP] the appeal\'s version moves once (the timer), Core\'s revision once', [a1.appeal_version - a0.appeal_version, [a1.overdue, a1.overdue_at], a1.info_requests, after.version.revision - before.version.revision], [1, [true, due], a0.info_requests, 1]);
      const { duplicate } = await s.infra.call('env.apply_event', { expected_version: after.version, event: ev });
      const replay = await s.snap();
      equal('T14 [MCP] an exact replay moves neither', [duplicate, replay.snapshot.data, replay.version], [true, after.snapshot.data, after.version]);
    }
    {
      const s = await session('t05-instant', withClaim(S.granted(S.base(), 'm-2', 'act'), 'cl-7', 'm-2', [office()]));
      await s.advance(REVIEW);
      const out = await s.settle('coverage.cob', { member_id: 'm-2', plan_year: 2026, answer: 'none' });
      const d = await s.data();
      equal('T05 [MCP] a cob confirm at exactly review_at commits after the review opened the request, and the claim posts at that instant', [out.coverage.attested_at, d.info_requests.map(r => [r.opened_at, r.status, r.answered_at]), V(d, 'cl-7').issued_at, C(d, 'cl-7').status], [REVIEW, [[REVIEW, 'answered', REVIEW]], REVIEW, 'processed']);
      const p = await s.persisted('cl-7');
      equal('T05 [MCP] the cob confirm at exactly review_at, committed, reopened and reloaded', p.actual, p.expected);
    }
    for (const order of ['decision first', 'answer first']) {
      const s = await session('t06-' + order.replace(' ', '-'), attest(withClaim(S.paPending(), 'cl-7', 'm-3', [S.line('ln-1', 1, 'svc-arthroscopy', '2026-11-17', 100000, { possible_accident: true })], 'pv-4'), 'm-3', 2026));
      await s.advance(AFTER_REVIEW);
      const decide = () => s.event('pa.decided', { pa_id: 'pa-2', decision: 'approved', units: 1, valid_from: '2026-11-01', valid_until: '2026-12-31' });
      const answer = () => s.settle('claims.info', { claim_id: 'cl-7', line_id: 'ln-1', answer: 'not_accident' });
      if (order === 'decision first') { assert.equal((await decide()).status, 'committed'); await answer(); } else { await answer(); assert.equal((await decide()).status, 'committed'); }
      const d = await s.data(), e = V(d, 'cl-7');
      equal('T06 [MCP] a pa.decided and the last accident answer at one instant, ' + order + ': its own EOB and PA counter', [e.issued_at, e.posting_seq, [e.lines[0].status, e.lines[0].reason, e.lines[0].pa_id], d.pas[0].approved_after_post, d.pas[0].units_used, d.pas[0].decided_at],
        order === 'decision first' ? [AFTER_REVIEW, '2', ['paid', null, 'pa-2'], '1', 1, AFTER_REVIEW] : [AFTER_REVIEW, '2', ['denied', 'prior_auth_missing', null], '2', 0, AFTER_REVIEW]);
      const p = await s.persisted('cl-7', 'pa-2');
      equal('T06 [MCP] ' + order + ': the PA view and stored counter', [p.pa.status, p.pa.units_used, p.mark], order === 'decision first' ? ['approved', 1, { status: 'approved', units_used: 1, approved_after_post: '1' }] : ['approved', 0, { status: 'approved', units_used: 0, approved_after_post: '2' }]);
      equal('T06 [MCP] ' + order + ': the claim, pa.get and the PA counter, committed, reopened and reloaded', p.actual, p.expected);
    }
    {
      const s = await session('t08-late', withClaim(S.base(), 'cl-7', 'm-1', [office()]));
      assert.equal((await s.event('pa.submitted', { pa_id: 'pa-7', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2026-12-01', valid_until: '2026-12-31' })).status, 'committed');
      assert.equal((await s.event('pa.withdrawn', { pa_id: 'pa-7' })).status, 'committed');
      const before = await s.snap();
      const late = { event_id: 't08-late-decision', at: AFTER_REVIEW, operation: 'pa.decided', payload: { pa_id: 'pa-7', decision: 'approved', units: 2, valid_from: '2026-12-01', valid_until: '2026-12-31' } };
      const out = await s.infra.call('env.apply_event', { expected_version: before.version, event: late });
      const after = await s.snap();
      equal('T08 [MCP] a fresh late pa.decided after pa.withdrawn with a due timer: the clock moves to its at, Core\'s revision increments once', [out.status, after.snapshot.virtual_now, after.version.revision - before.version.revision], ['committed', AFTER_REVIEW, 1]);
      equal('T08 [MCP] the withdrawn PA is unchanged, and the timer is committed once', [after.snapshot.data.pas, after.snapshot.data.eobs.filter(e => e.claim_id === 'cl-7').map(e => e.issued_at), C(after.snapshot.data, 'cl-7').processed_at], [before.snapshot.data.pas, [REVIEW], REVIEW]);
      const { duplicate, ...replay } = await s.infra.call('env.apply_event', { expected_version: after.version, event: late });
      const later = await s.snap();
      equal('T08 [MCP] an exact replay returns the receipt with no further timer effect', [duplicate, replay, later.snapshot.data, later.snapshot.receipts, later.version], [true, out, after.snapshot.data, after.snapshot.receipts, after.version]);
      const status = await s.infra.call('env.event_status', { event_id: late.event_id });
      equal('T08 [MCP] the fresh receipt read back through env.event_status', [status.status, status.receipt], ['ok', out]);
      const read = await s.snap();
      const conflict = await s.infra.call('env.apply_event', { expected_version: read.version, event: { ...late, payload: { ...late.payload, units: 3 } } });
      const end = await s.snap();
      equal('T20 [MCP] a committed event ID replayed with changed content → idempotency_conflict, with one denial row and nothing stored', [conflict.status, delta(read, end), end.snapshot.data, end.snapshot.receipts, end.version], ['idempotency_conflict', [['infra', 'env.apply_event', 'deny']], later.snapshot.data, later.snapshot.receipts, later.version]);
    }
    {
      const s = await session('t08-covered', S.paApproved());
      const ev = { event_id: 't08-covered', at: NOW, operation: 'pa.submitted', payload: { pa_id: 'pa-7', member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2026-12-01', valid_until: '2026-12-31' } };
      const first = await s.infra.call('env.apply_event', { expected_version: await s.version(), event: ev });
      const once = await s.snap();
      const { duplicate, ...again } = await s.infra.call('env.apply_event', { expected_version: once.version, event: ev });
      const d = await s.data();
      equal('T08 [MCP] the covered-submission replay equal to its original receipt with one entry', [first.status, duplicate, again, d.pas.map(p => p.pa_id), d.pas[0].covered_submissions.map(x => [x.pa_id, x.units, x.at]), d.pas[0].units_used, d.notices.length], ['committed', true, first, ['pa-1'], [['pa-7', 2, NOW]], 0, 0]);
    }
    {
      const s = await session('mark-zero', S.household());
      check('T05 [MCP] the household starts with no posting', (await s.data()).eobs.length === 0);
      assert.equal((await s.event('pa.submitted', { pa_id: 'pa-8', member_id: 'm-1', provider_id: 'pv-3', service_id: 'svc-physical-therapy', units: 2, valid_from: '2026-11-01', valid_until: '2026-12-31' })).status, 'committed');
      assert.equal((await s.event('pa.decided', { pa_id: 'pa-8', decision: 'approved', units: 2, valid_from: '2026-11-01', valid_until: '2026-12-31' })).status, 'committed');
      const approved = (await s.data()).pas[0];
      equal('T05 [MCP] a pending PA approved live before any posting stores approved_after_post "0"', [approved.status, approved.approved_after_post, approved.decided_at], ['approved', '0', NOW]);
      assert.equal((await s.event('claim.received', { claim_id: 'cl-7', member_id: 'm-1', provider_id: 'pv-3', lines: [live('ln-1', 'svc-physical-therapy', '2026-11-17', 15000)] })).status, 'committed');
      await s.advance(AFTER_REVIEW);
      assert.equal((await s.nudge()).status, 'committed');
      const p = await s.persisted('cl-7', 'pa-8');
      equal('T05 [MCP] a PA approved before the first posting (approved_after_post: "0") used by a claim, committed and reopened', [p.claim.lines[0].outcome.status, p.claim.lines[0].outcome.pa_id, p.claim.lines[0].outcome.pa_units, p.pa.units_used, p.mark], ['paid', 'pa-8', 1, 1, { status: 'approved', units_used: 1, approved_after_post: '0' }]);
      equal('T05 [MCP] the claim, pa.get and the stored "0" mark after reopen and reload', p.actual, p.expected);
      const stored = { ...(await s.data()), approvals: [] };
      const nullMark = S.edit(structuredClone(stored), x => { x.pas[0].approved_after_post = null; });
      const contradicting = S.edit(structuredClone(stored), x => { x.pas[0].approved_after_post = '1'; });
      equal('T05 [MCP] a null mark and a mark contradicting decided_at → invalid_seed', [(await s.load(nullMark, 'mark-null', AFTER_REVIEW)).status, (await s.load(contradicting, 'mark-late', AFTER_REVIEW)).status], ['invalid_seed', 'invalid_seed']);
    }
    {
      const seed = S.ledger([{ member: 'm-1', year: 2026, deductible_cents: 100000 }, { member: 'm-2', year: 2026, deductible_cents: 30000 }]);
      const s = await session('ledger-keys', S.base());
      const swap = ({ deductible_cents, oop_cents }) => ({ oop_cents, deductible_cents });
      const shuffled = S.edit(structuredClone(seed), x => { for (const e of x.eobs) e.ledger_before = Object.fromEntries(Object.entries(e.ledger_before).reverse().map(([y, v]) => [y, { family: swap(v.family), member: swap(v.member) }])); });
      check('T21 [MCP] the reordered ledger_before differs from the builder\'s only in key order', JSON.stringify(shuffled.eobs.map(e => e.ledger_before)) !== JSON.stringify(seed.eobs.map(e => e.ledger_before)));
      const off = S.edit(structuredClone(seed), x => { x.eobs.at(-1).ledger_before['2026'].family.deductible_cents += 1; });
      equal('T21 [MCP] the seed\'s ledger_before with its keys in another order loads, one cent off is rejected', [(await s.load(shuffled, 'keys-shuffled')).status, (await s.load(off, 'keys-off')).status], ['ready', 'invalid_seed']);
    }
    {
      const s = await session('t09-instant', S.deniedClaim());
      const appeal = (await s.settle('appeals.file', { target_type: 'claim', target_id: 'cl-3', statement: 'The provider was listed as in network.' })).appeal;
      assert.equal((await s.event('appeal.decided', { appeal_id: appeal.appeal_id, outcome: 'overturned', lines: ['ln-2'] })).status, 'committed');
      const p = await s.persisted('cl-3');
      const a = (await s.data()).appeals[0];
      equal('T09 [MCP] a claim appeal filed and overturned at one instant', [a.filed_at, a.decided_at, a.status, p.claim.eobs.map(e => [e.version, e.issued_at, e.lines.map(l => l.status)])], [NOW, NOW, 'overturned', [[1, '2026-11-15T23:59:00-05:00', ['denied', 'denied']], [2, NOW, ['denied', 'paid']]]]);
      equal('T09 [MCP] the appeal filed and overturned at one instant, committed and reopened', p.actual, p.expected);
    }
    {
      const s = await session('validity', S.paApproved());
      await s.advance('2027-03-01T09:00:00-05:00');
      const pa = (await s.read('pa.get', { pa_id: 'pa-1' })).pa;
      const raw = (await s.data()).pas[0];
      equal('T06 [MCP] env.advance_time past a PA\'s validity: reads report expired, the snapshot keeps approved', [pa.status, pa.expired_at, raw.status, raw.expired_at], ['expired', '2027-02-28T23:59:00-05:00', 'approved', null]);
      assert.equal((await s.nudge()).status, 'committed');
      const stored = (await s.data()).pas[0];
      equal('T06 [MCP] until the next commit', [stored.status, stored.expired_at], ['expired', '2027-02-28T23:59:00-05:00']);
    }
    {
      const s0 = attest(S.base(), 'm-3', 2026);
      S.claim(s0, { claim_id: 'cl-p', member_id: 'm-3', provider_id: 'pv-3', received_at: '2026-11-12T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-11', 15000)] });
      S.window(s0, 'claim', 'cl-p', S.process(s0, 'cl-p', [S.denied('ln-1', 'prior_auth_missing', 15000)]).issued_at);
      S.paApproved(4, { valid_from: '2026-11-01', valid_until: '2026-12-31' }, S.finalize(s0));
      s0.pas[0].decided_at = '2026-11-16T10:00:00-05:00';
      const seed = S.openAppeal({ type: 'claim', id: 'cl-p' }, 'under_review', S.finalize(s0));
      check('T09 [MCP] the sparse seed\'s covering PA arrived after the denial posted', seed.pas[0].approved_after_post === V(seed, 'cl-p').posting_seq);
      const s = await session('sparse-overturn', seed);
      assert.equal((await s.event('appeal.decided', { appeal_id: 'ap-1', outcome: 'overturned', lines: ['ln-1'] })).status, 'committed');
      const p = await s.persisted('cl-p');
      const d = await s.data(), v1 = V(d, 'cl-p'), v2 = V(d, 'cl-p', 2);
      equal('T09 [MCP] a sparse valid seed overturned over MCP (a prior_auth_missing denial overturned after a covering PA arrived): both EOBs, the posting difference and zero PA units',
        [p.claim.eobs.map(e => [e.version, e.lines[0].status, e.lines[0].reason, e.lines[0].pa_id, e.lines[0].pa_units]), v2.postings[0].oop_cents - v1.postings[0].oop_cents, d.accumulators.find(a => a.member_id === 'm-3' && a.plan_year === 2026).oop_cents, d.pas[0].units_used],
        [[[1, 'denied', 'prior_auth_missing', null, 0], [2, 'paid', null, null, 0]], 3500, 3500, 0]);
      equal('T09 [MCP] the sparse overturn, reopened', p.actual, p.expected);
    }
    {
      const s = await session('seed-rejects', S.base());
      const repost = x => { for (const e of x.eobs) { const c = C(x, e.claim_id); e.postings = e.postings.map(p => { const mine = e.lines.filter(l => Number(c.lines.find(y => y.line_id === l.line_id).service_date.slice(0, 4)) === p.plan_year); return { ...p, deductible_cents: mine.reduce((t, l) => t + l.deductible_cents, 0), oop_cents: mine.reduce((t, l) => t + l.member_cost_cents, 0) }; }); } return S.finalize(x); };
      const small = split => { const x = S.base(); S.claim(x, { claim_id: 'cl-x', member_id: 'm-1', provider_id: 'pv-2', received_at: '2026-11-13T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-knee-mri', '2026-11-12', 100)] }); S.process(x, 'cl-x', [S.paid('ln-1', 100, split, 100)]); return S.finalize(x); };
      const capped = copays => { const x = S.base(); Object.assign(x.plan.years['2026'], { deductible: { individual_cents: 5000, family_cents: 300000 }, oop_max: { individual_cents: 6000, family_cents: 800000 } }); S.claim(x, { claim_id: 'cl-y', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-13T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-office-visit', '2026-11-12', 21000), S.line('ln-2', 2, 'svc-office-visit', '2026-11-12', 21000)] }); S.process(x, 'cl-y', copays.map((c, i) => S.paid('ln-' + (i + 1), 18000, { copay: c }, 21000))); return S.finalize(x); };
      const overUsed = () => {
        const x = S.paUsed(S.paApproved(1));
        S.claim(x, { claim_id: 'cl-8', member_id: 'm-3', provider_id: 'pv-3', received_at: '2026-11-14T10:00:00-05:00', lines: [S.line('ln-1', 1, 'svc-physical-therapy', '2026-11-13', 15000)] });
        S.process(x, 'cl-8', [S.paid('ln-1', 15000, { copay: 3500 }, 15000, { id: 'pa-1', units: 1 })]);
        x.pas[0].units_used = 2;
        return S.finalize(x);
      };
      const overlap = x => { const a = x.appeals[0]; x.appeals.push({ ...structuredClone(a), appeal_id: 'ap-2', filed_at: '2026-11-17T10:00:00-05:00', filed_seq: '2', statements: [{ ...a.statements[0], at: '2026-11-17T10:00:00-05:00' }] }); x.issued.ap = '2'; x.issued.file = '2'; };
      const impossible = [
        ['a missing v2', S.edit(S.overturned(), x => { x.eobs = x.eobs.filter(e => !(e.claim_id === 'cl-3' && e.version === 2)); })],
        ['a partial v2', S.edit(S.overturned(), x => { const v2 = V(x, 'cl-3', 2); v2.lines[1] = structuredClone(V(x, 'cl-3').lines[1]); Object.assign(v2.postings[0], { deductible_cents: v2.lines.reduce((t, l) => t + l.deductible_cents, 0), oop_cents: v2.lines.reduce((t, l) => t + l.member_cost_cents, 0) }); S.finalize(x); })],
        ['a v1 PA-listed paid line without pa_id', S.edit(S.paUsed(), x => { Object.assign(V(x, 'cl-5').lines[0], { pa_id: null, pa_units: 0 }); x.pas[0].units_used = 0; })],
        ['a short copay', repost(S.edit(S.base(), x => Object.assign(V(x, 'cl-1').lines[0], { copay_cents: 2400, member_cost_cents: 2400, plan_paid_cents: 15600 })))],
        ['over-used PA units', overUsed()],
        ['the 0/20/80 split', small({ coins: 20 })],
        ['an early short copay hidden by a later cap', capped([2000, 1500])],
        ['an emergency PA attribution', S.edit(S.paUsed(), x => { C(x, 'cl-5').lines[0].emergency = true; })],
        ['a stranded pending_info claim', S.edit(S.pendingCob(), x => { x.info_requests[0].status = 'expired'; }), '2027-01-01T00:00:00-05:00'],
        ['a duplicate request', S.edit(S.pendingCob('m-2', 2026, S.base(), true), x => { x.info_requests.push({ ...x.info_requests[1], info_request_id: 'ir-3' }); x.issued.ir = '3'; })],
        ['a missing request', S.edit(S.pendingCob('m-2', 2026, S.base(), true), x => { x.info_requests.pop(); })],
        ['overlapping appeals', S.edit(S.openAppeal(), overlap)],
      ];
      const ctx = { app_id: 'larkfield-health', run_id: 'seed-rejects', role: 'infra', virtual_now: NOW, binding: structuredClone(require('../fixtures/binding.json')) };
      const noticed = () => plugin.applyEvent(ctx, S.paPending(), { event_id: 'deny', at: NOW, operation: 'pa.decided', payload: { pa_id: 'pa-2', decision: 'denied' } });
      plugin.validateSeed(ctx, noticed());
      check('[MCP] the notice seed carries PA notices', noticed().notices.length > 0 && noticed().notices[0].subject.type === 'pa' && noticed().notices[0].notice_id === 'n-1');
      const missing = [
        ['a claim\'s member', S.edit(S.received(), x => { C(x, 'cl-2').member_id = 'm-9'; })],
        ['a claim\'s provider', S.edit(S.received(), x => { C(x, 'cl-2').provider_id = 'pv-9'; })],
        ['a claim line\'s service', S.edit(S.received(), x => { C(x, 'cl-2').lines[0].service_id = 'svc-x'; })],
        ['a service\'s fee', S.edit(S.base(), x => { x.services[0].fee_cents = null; })],
        ['a PA-list service', S.edit(S.base(), x => { x.plan.pa_services.push('svc-x'); })],
        ['a guardian', S.edit(S.base(), x => { x.members[2].guardian_ids = ['m-1', 'm-9']; })],
        ['a request\'s claim', S.edit(S.pendingCob(), x => { x.info_requests[0].claim_id = 'cl-9'; })],
        ['an EOB\'s claim', S.edit(S.base(), x => { x.eobs[0].claim_id = 'cl-9'; })],
        ['an EOB line\'s PA', S.edit(S.paUsed(), x => { V(x, 'cl-5').lines[0].pa_id = 'pa-9'; })],
        ['an EOB\'s appeal', S.edit(S.overturned(), x => { V(x, 'cl-3', 2).appeal_id = 'ap-9'; })],
        ['an accumulator\'s member', S.edit(S.base(), x => { x.accumulators.push({ member_id: 'm-9', plan_year: 2026, deductible_cents: 0, oop_cents: 0 }); })],
        ['a PA\'s member', S.edit(S.paPending(), x => { x.pas[0].member_id = 'm-9'; })],
        ['a PA\'s provider', S.edit(S.paPending(), x => { x.pas[0].provider_id = 'pv-9'; })],
        ['a PA\'s service', S.edit(S.paPending(), x => { x.pas[0].service_id = 'svc-x'; })],
        ['an appeal\'s claim', S.edit(S.openAppeal(), x => { x.appeals[0].target.id = 'cl-9'; })],
        ['an appeal\'s PA', S.edit(S.openAppeal({ type: 'pa', id: 'pa-3' }), x => { x.appeals[0].target.id = 'pa-9'; })],
        ['an appeal statement\'s author', S.edit(S.openAppeal(), x => { x.appeals[0].statements[0].by = 'm-9'; })],
        ['a grant\'s member', S.edit(S.granted(), x => { x.grants[0].member_id = 'm-9'; })],
        ['a grant\'s grantee', S.edit(S.granted(), x => { x.grants[0].grantee_id = 'm-9'; })],
        ['a notice\'s subject', S.edit(noticed(), x => { x.notices[0].subject.id = 'pa-404'; })],
      ];
      const before = await s.snap();
      const WHY = {
        'a missing v2': /^Overturned appeal ap-1 does not have exactly one EOB version\.$/, 'a partial v2': /^EOB eob-3 changes lines other than those its appeal overturned\.$/,
        'a v1 PA-listed paid line without pa_id': /^EOB eob-2 line ln-1 is a paid PA-listed line without a PA\.$/, 'a short copay': /^EOB eob-1 line ln-1 amounts differ from the plan's pricing/,
        'over-used PA units': /^PA pa-1 units used differ from its paid lines or exceed the approved units\.$/, 'the 0/20/80 split': /^EOB eob-2 line ln-1 amounts differ from the plan's pricing/,
        'an early short copay hidden by a later cap': /^EOB eob-2 line ln-1 amounts differ from the plan's pricing/, 'an emergency PA attribution': /^EOB eob-2 line ln-1 uses a PA although it is an emergency or not PA-listed\.$/,
        'a stranded pending_info claim': /^Claim cl-4 is pending information without an open request, or with an EOB\.$/, 'a duplicate request': /^Information request ir-3 repeats a request of its type on line ln-1\.$/,
        'a missing request': /^Claim cl-4 carries requests other than those its review opens\.$/, 'overlapping appeals': /^Appeal ap-2 on claim:cl-3 was filed while ap-1 was open or decided\.$/,
        'a claim\'s member': /^Claim cl-2 names an unknown member m-9\.$/, 'a claim\'s provider': /^Claim cl-2 names an unknown provider pv-9\.$/, 'a claim line\'s service': /^Claim cl-2 names an unknown service svc-x\.$/,
        'a service\'s fee': /has no fee/, 'a PA-list service': /^The plan's PA list names an unknown service svc-x\.$/, 'a guardian': /^Member m-3 names an unknown guardian m-9\.$/,
        'a request\'s claim': /^Information request ir-1 names an unknown claim cl-9\.$/, 'an EOB\'s claim': /^EOB eob-1 names an unknown claim cl-9\.$/, 'an EOB line\'s PA': /^EOB eob-2 line ln-1 names an unknown PA pa-9\.$/,
        'an EOB\'s appeal': /^EOB eob-3 names an unknown appeal ap-9\.$/, 'an accumulator\'s member': /^Accumulator of m-9 for 2026 names an unknown member m-9\.$/, 'a PA\'s member': /^PA pa-2 names an unknown member m-9\.$/,
        'a PA\'s provider': /^PA pa-2 names an unknown provider pv-9\.$/, 'a PA\'s service': /^PA pa-2 names an unknown service svc-x\.$/, 'an appeal\'s claim': /^Appeal ap-1 names an unknown claim cl-9\.$/,
        'an appeal\'s PA': /^Appeal ap-1 names an unknown PA pa-9\.$/, 'an appeal statement\'s author': /^Appeal ap-1 statement is by an unknown person m-9\.$/, 'a grant\'s member': /^Grant gr-h1 names an unknown member m-9\.$/,
        'a grant\'s grantee': /^Grant gr-h1 grantee m-9 is not in the run binding\.$/, 'a notice\'s subject': /^Notice n-1 names an unknown pa pa-404\.$/,
      };
      const statuses = async list => { const out = []; for (const [label, data, when] of list) { const r = await s.load(data, label.replace(/[^a-z0-9]+/gi, '-'), when); out.push([label, r.status, WHY[label].test(r.message) ? 'its own rule' : r.message]); } return out; };
      equal('T21 [MCP] env.load_seed rejects, each for its own rule, a missing v2, a partial v2, a v1 PA-listed paid line without pa_id, a short copay, over-used PA units, the 0/20/80 split, an early short copay hidden by a later cap, an emergency PA attribution, a stranded pending_info claim, duplicate or missing requests, and overlapping appeals (invalid_seed)',
        await statuses(impossible), impossible.map(([label]) => [label, 'invalid_seed', 'its own rule']));
      equal('[MCP] invalid_seed per missing reference, each for its own rule', await statuses(missing), missing.map(([label]) => [label, 'invalid_seed', 'its own rule']));
      const after = await s.snap();
      equal('[MCP] every rejected load keeps the loaded data and version', [after.snapshot.data, after.version], [before.snapshot.data, before.version]);
    }
    {
      const s = await session('bad-date', S.base());
      const before = await s.snap();
      const out = await s.event('claim.received', intake('cl-8', live('ln-1', 'svc-office-visit', '2026-02-30', 21000)), '2026-11-19T09:00:00-05:00');
      const after = await s.snap();
      equal('[MCP] a live claim.received carrying 2026-02-30 → invalid_event with clock and business data unchanged', [out.status, after.snapshot.virtual_now, after.snapshot.data, after.version, delta(before, after)], ['invalid_event', NOW, before.snapshot.data, before.version, [['infra', 'env.apply_event', 'deny']]]);
      const noExpiry = await s.event('grant.changed', { grant_id: 'gr-h9', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', status: 'active' });
      const end = await s.snap();
      equal('T16 [MCP] a full active grant.changed omitting expires_at → Core\'s invalid_arguments over MCP', [noExpiry.status, end.snapshot.data, end.version], ['invalid_arguments', before.snapshot.data, before.version]);
    }
    {
      const s = await session('fresh-bad', withClaim(S.base(), 'cl-7', 'm-1', [office()]));
      const b1 = await s.snap();
      const back = await s.event('pa.withdrawn', { pa_id: 'pa-9' }, '2026-11-18T11:00:00-05:00');
      const b2 = await s.snap();
      const malformed = await s.event('pa.decided', { pa_id: 'pa-9', decision: 'approved', units: 1 }, AFTER_REVIEW);
      const end = await s.snap();
      equal('[MCP] a fresh backdated event is invalid_event and a malformed one invalid_arguments', [back.status, malformed.status], ['invalid_event', 'invalid_arguments']);
      equal('[MCP] each adds exactly one denial row and preserves data, notices, receipts, version and clock', [delta(b1, b2), delta(b2, end), end.snapshot.data, end.snapshot.receipts, end.version, end.snapshot.virtual_now], [[['infra', 'env.apply_event', 'deny']], [['infra', 'env.apply_event', 'deny']], b1.snapshot.data, b1.snapshot.receipts, b1.version, NOW]);
    }
    {
      const s = await session('rollback', withClaim(S.base(), 'cl-7', 'm-1', [office()]));
      await s.advance(AFTER_REVIEW);
      check('[MCP] the claim\'s review is due before the rejected event', (await s.read('claims.get', { claim_id: 'cl-7' })).claim.status === 'processed');
      const current = await s.snap();
      const bundle = structuredClone(current.snapshot.resources.bundle);
      bundle.dataset.expected_counts = { ...bundle.dataset.expected_counts, records: plugin.records(current.snapshot.data).length };
      const valid = await s.infra.call('env.validate_bundle', { data: current.snapshot.data, bundle });
      const pre = await s.snap();
      check('[MCP] the event\'s bundle is valid for the record count before the event, while the claim is still stored as received', valid.status === 'ok' && C(pre.snapshot.data, 'cl-7').status === 'received');
      const ev = { event_id: 'rollback-bundle', at: '2026-11-22T09:30:00-05:00', operation: 'claim.received', payload: intake('cl-8', live('ln-1', 'svc-office-visit', '2026-11-21', 21000)) };
      const rejected = await s.infra.call('env.apply_event', { expected_version: pre.version, event: ev, bundle });
      const end = await s.snap();
      equal('[MCP] Core rejects the bundle only after the handler ran: the intake and the due review change the record count', [rejected.status, plugin.records(plugin.applyEvent({ app_id: 'larkfield-health', run_id: 'rollback', role: 'infra', virtual_now: ev.at, binding: structuredClone(require('../fixtures/binding.json')) }, structuredClone(pre.snapshot.data), ev)).length > bundle.dataset.expected_counts.records], ['invalid_bundle', true]);
      equal('[MCP] a post-handler Core rejection preserving clock, data, version and notices with one denial row: neither the intake nor the review is stored', [end.snapshot.data, end.version, end.snapshot.virtual_now, delta(pre, end), end.snapshot.receipts, end.snapshot.data.claims.map(c => [c.claim_id, c.status]), V(end.snapshot.data, 'cl-7') ?? null],
        [pre.snapshot.data, pre.version, AFTER_REVIEW, [['infra', 'env.apply_event', 'deny']], pre.snapshot.receipts, [['cl-1', 'processed'], ['cl-7', 'received']], null]);
      const ok = await s.infra.call('env.apply_event', { expected_version: (await s.version()), event: { ...ev, event_id: 'rollback-plain' } });
      equal('[MCP] the same event without the bundle commits both the intake and the review', [ok.status, (await s.data()).claims.map(c => [c.claim_id, c.status])], ['committed', [['cl-1', 'processed'], ['cl-7', 'processed'], ['cl-8', 'received']]]);
    }
    {
      const s = await session('replay-due', withClaim(S.base(), 'cl-7', 'm-1', [office()]));
      const ev = { event_id: 'replay-due-ev', at: NOW, operation: 'user.confirmed', payload: { token: 'tok-unrelated', confirmed_by: 'm-1' } };
      const one = await s.infra.call('env.apply_event', { expected_version: await s.version(), event: ev });
      await s.advance(AFTER_REVIEW);
      const before = await s.snap();
      check('T20 [MCP] the claim\'s review became due after the event', (await s.read('claims.get', { claim_id: 'cl-7' })).claim.status === 'processed');
      const { duplicate, ...two } = await s.infra.call('env.apply_event', { expected_version: before.version, event: ev });
      const after = await s.snap();
      equal('T20 [MCP] replay without catch-up after timers became due', [one.status, duplicate, two, after.snapshot.data, after.version, C(after.snapshot.data, 'cl-7').status], ['committed', true, one, before.snapshot.data, before.version, 'received']);
    }
    {
      const top = '100000000000000', next = '100000000000001';
      const s = await session('counters', S.edit(S.base(), x => { for (const k of ['seq', 'post', 'eob', 'ir', 'cf', 'n', 'ap', 'file', 'gr']) x.issued[k] = top; }));
      const received = await s.event('claim.received', intake('cl-8', live('ln-1', 'svc-office-visit', '2026-11-17', 21000)));
      const fresh = await open('agent', 'counters');
      const reopened = (await fresh.call(P + 'claims.get', { claim_id: 'cl-8' })).claim;
      const d = await s.data();
      equal('[MCP] a seed with counters at the initial_data limit loaded, one intake committed, the run reopened through Core\'s serialized state, and the 15-digit next value still valid', [received.status, reopened.claim_id, C(d, 'cl-8').received_seq, d.issued.seq], ['committed', 'cl-8', next, next]);
      await s.advance(AFTER_REVIEW);
      assert.equal((await s.nudge()).status, 'committed');
      const e = (await s.data()), eob = V(e, 'cl-8');
      equal('[MCP] the review then issues the next 15-digit EOB, posting, notice and approval values', [eob.eob_id, eob.posting_seq, e.notices.map(n => n.notice_id), e.approvals.map(a => a.approval_id)], ['eob-' + next, next, ['n-' + next], ['cf-' + next]]);
    }
    {
      const s = await session('ledger-chain', S.edit(S.household(), x => { x.plan.years['2026'].deductible = { individual_cents: 100, family_cents: 300 }; }));
      assert.equal((await s.event('claim.received', { claim_id: 'cl-a', member_id: 'm-1', provider_id: 'pv-2', lines: [live('ln-1', 'svc-knee-mri', '2026-11-17', 100), { ...live('ln-2', 'svc-arthroscopy', '2026-11-17', 100) }] })).status, 'committed');
      await s.advance(AFTER_REVIEW);
      assert.equal((await s.nudge()).status, 'committed');
      const appeal = (await s.settle('appeals.file', { target_type: 'claim', target_id: 'cl-a', statement: 'The surgery was authorised by phone.' })).appeal;
      assert.equal((await s.event('appeal.decided', { appeal_id: appeal.appeal_id, outcome: 'overturned', lines: ['ln-2'] })).status, 'committed');
      assert.equal((await s.event('claim.received', intake('cl-c', live('ln-1', 'svc-lab-panel', '2026-11-21', 9000)))).status, 'committed');
      await s.advance('2026-11-26T09:00:00-05:00');
      assert.equal((await s.nudge()).status, 'committed');
      const d = await s.data(), v1 = V(d, 'cl-a'), v2 = V(d, 'cl-a', 2), third = V(d, 'cl-c');
      const p = await s.persisted('cl-c');
      equal('T09 [MCP] v1 → overturn → another claim: the ledger just before the third claim posts shows 100¢ deductible and 120¢ out-of-pocket, where v1 took the last 100¢ of deductible and the overturn added 20¢ of coinsurance',
        [[v1.lines.map(l => [l.status, l.deductible_cents]), v1.postings[0]], [v2.lines[1].coinsurance_cents, v2.postings[0].oop_cents - v1.postings[0].oop_cents], third.ledger_before['2026'].member],
        [[[['paid', 100], ['denied', 0]], { member_id: 'm-1', plan_year: 2026, deductible_cents: 100, oop_cents: 100 }], [20, 20], { deductible_cents: 100, oop_cents: 120 }]);
      equal('T09 [MCP] the third claim, committed, reopened and reloaded', p.actual, p.expected);
    }
    {
      const LOADED = '2026-11-25T09:00:00-05:00';
      const s = await session('t20', S.granted(attest(S.paPending(undefined, S.received()), 'm-2', 2026)), LOADED);
      const seeded = await s.snap();
      const read = (await s.read('claims.get', { claim_id: 'cl-2' })).claim;
      equal('T20 [MCP] a seed loaded after the review cutoff for a received claim that needs neither information request → reads report the processed claim', [read.status, read.info_requests, read.eobs.map(e => [e.version, e.issued_at]), C(seeded.snapshot.data, 'cl-2').status], ['processed', [], [[1, '2026-11-20T23:59:00-05:00']], 'received']);
      const first = await s.write('pa.request_expedite', { pa_id: 'pa-2', reason: 'The knee is getting worse.' });
      const once = await s.snap();
      assert.equal((await s.nudge()).status, 'committed');
      const twice = await s.snap();
      equal('T20 [MCP] and the first fresh successful write persists the review once', [first.status, C(once.snapshot.data, 'cl-2').processed_at, appended(seeded, once), twice.snapshot.data.eobs, appended(once, twice)],
        ['committed', '2026-11-20T23:59:00-05:00', [['notice.eob_available', 'm-1', 'cl-2', '2026-11-20T23:59:00-05:00'], ['notice.eob_available', 'm-2', 'cl-2', '2026-11-20T23:59:00-05:00']], once.snapshot.data.eobs, []]);
      const ev = { event_id: 't20-ev', at: LOADED, operation: 'user.confirmed', payload: { token: 'tok-unrelated', confirmed_by: 'm-1' } };
      const original = await s.infra.call('env.apply_event', { expected_version: twice.version, event: ev });
      const { duplicate, ...replay } = await s.infra.call('env.apply_event', { expected_version: await s.version(), event: ev });
      equal('T20 [MCP] a repeated event ID → stored receipt', [original.status, duplicate, replay], ['committed', true, original]);
      await s.advance('2026-11-26T09:00:00-05:00');
      const old = await s.version();
      check('T20 [MCP] approvals are stored and the clock advanced before the reset', (await s.data()).approvals.length === 2 && old.revision > 0);
      equal('T20 [MCP] reset is ready', (await s.infra.call('env.reset', { expected_version: old })).status, 'ready');
      const back = await s.snap();
      equal('T20 [MCP] reset restores seed and loaded time, approvals gone', [back.snapshot.data, back.snapshot.virtual_now, back.snapshot.data.approvals, back.version], [seeded.snapshot.data, LOADED, [], { epoch: old.epoch + 1, revision: 0 }]);
      for (let i = 1; i <= old.revision; i++) await s.advance(new Date(Date.parse(LOADED) + i * 60000).toISOString());
      const current = await s.version();
      equal('T20 [MCP] the new epoch reaches the pre-reset revision', current, { epoch: old.epoch + 1, revision: old.revision });
      const staleWrite = await s.agent.call(P + 'pa.request_expedite', { pa_id: 'pa-2', reason: 'Again.', request_id: 't20-old-write', expected_version: old });
      const staleEvent = await s.infra.call('env.apply_event', { expected_version: old, event: { ...ev, event_id: 't20-old-event', at: (await s.snap()).snapshot.virtual_now } });
      equal('T20 [MCP] pre-reset write and event versions → stale_version', [staleWrite.status, staleEvent.status], ['stale_version', 'stale_version']);
      equal('T20 [MCP] the same write with the current version commits', (await s.agent.call(P + 'pa.request_expedite', { pa_id: 'pa-2', reason: 'Again.', request_id: 't20-new-write', expected_version: current })).status, 'committed');
    }
    {
      const s = await session('t20-seed', S.deniedClaim());
      const file = { target_type: 'claim', target_id: 'cl-3', statement: 'Please review the network status.' };
      const pv = await s.read('appeals.file.preview', file);
      equal('T20 [MCP] a seed with another seed ID loads', (await s.load(S.edit(S.deniedClaim(), x => { x.seed_id = 'larkfield-test-household-b'; }), 'other-seed')).status, 'ready');
      assert.equal((await s.event('user.confirmed', { token: pv.preview.token, confirmed_by: 'm-1' })).status, 'committed');
      const before = await s.snap();
      const out = await s.write('appeals.file.confirm', { ...file, token: pv.preview.token });
      const after = await s.snap();
      equal('T20 [MCP] a token previewed under a different seed → stale_preview with an approval', [out.status, before.snapshot.data.approvals.map(a => [a.token, a.used_at]), after.snapshot.data, after.version], ['stale_preview', [[pv.preview.token, null]], before.snapshot.data, before.version]);
    }
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

main().then(() => {
  const report = { schema: 'larkfield.mcp-integration.v1', runtime: require(path.join(runtimeDir, 'package.json')).version, node: process.version, checks, passed: true };
  if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); }
  console.log('mcp integration passed ' + checks.length + ' checks');
}, error => {
  if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify({ schema: 'larkfield.mcp-integration.v1', checks, passed: false, error: error.message }, null, 2) + '\n'); }
  console.error(error.message);
  process.exit(1);
});
