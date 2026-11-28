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
const { baseSeed, rx } = require('./seeds.cjs');
const minimal = require('./unit-seed.json');

const P = 'mendwell-pharmacy.';
const checks = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push({ name, status: 'passed' }); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, status: 'passed' }); };
const NOW = '2026-11-30T09:00:00-05:00';
const pa = s => { s.plans.find(x => x.plan_id === 'plan-b').rules['d-atorvastatin-40'].prior_auth_required = true; return s; };
const withRx2 = s => { s.prescriptions.push(rx('rx-2')); return s; };

async function main() {
  const prepared = prepare(appDir);
  const clients = [];
  const open = async (role, run) => {
    const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'mendwell-mcp-check', { registry: prepared.registry });
    clients.push(c);
    await c.initialize();
    return c;
  };
  const session = async (run, seed, at = NOW) => {
    const infra = await open('infra', run), agent = await open('agent', run);
    let n = 0;
    const snap = () => infra.call('env.snapshot');
    const version = async () => (await snap()).version;
    const writeArgs = async (args, id) => ({ ...args, request_id: id || run + '-w' + (++n), expected_version: await version() });
    const write = async (name, args, id) => agent.call(P + name, await writeArgs(args, id));
    const read = (name, args = {}) => agent.call(P + name, args);
    const advance = async t => infra.call('env.advance_time', { expected_version: await version(), virtual_now: t, request_id: run + '-t' + (++n) });
    const event = async (operation, payload, at2, id) => infra.call('env.apply_event', { expected_version: await version(), event: { event_id: id || run + '-e' + (++n), at: at2 || (await snap()).snapshot.virtual_now, operation, payload } });
    const fill = async id => (await snap()).snapshot.data.fills.find(f => f.fill_id === id);
    if (seed) {
      const loaded = await infra.call('env.load_seed', { expected_version: await version(), data: seed, virtual_now: at, request_id: run + '-seed' });
      assert.equal(loaded.status, 'ready', run + ' seed loads: ' + JSON.stringify(loaded));
    }
    return { infra, agent, snap, version, writeArgs, write, read, advance, event, fill };
  };
  const delta = (before, after) => after.snapshot.audit.slice(before.snapshot.audit.length).map(x => [x.actor, x.tool, x.decision]);
  const omit = (o, key) => { const { [key]: gone, ...rest } = o; return rest; };

  try {
    equal('The package wire schema is byte-identical to the runtime contract', fs.readFileSync(path.join(appDir, 'schemas/router-message.schema.json')), fs.readFileSync(path.join(runtimeDir, 'contracts/schemas/router-message.schema.json')));
    {
      const s = await session('t02', structuredClone(minimal));
      const other = await open('agent', 't02');
      const v = await s.version();
      const request = (client, store, id) => client.call(P + 'fills.request', { rx_id: 'rx-1', store_id: store, quantity: 30, request_id: id, expected_version: v });
      const [a, b] = await Promise.all([request(s.agent, 'st-1', 't02-a'), request(other, 'st-2', 't02-b')]);
      equal('T02 [MCP] two Agent clients race one version: exactly one request commits and the other is stale_version', [a.status, b.status].sort(), ['committed', 'stale_version']);
      const [winner, loser, store, id] = a.status === 'committed' ? ['st-1', other, 'st-2', 't02-b'] : ['st-2', s.agent, 'st-1', 't02-a'];
      equal('T02 [MCP] the stored data holds exactly the winner\'s fill', (await s.snap()).snapshot.data.fills.map(f => [f.rx_id, f.store_id]), [['rx-1', winner]]);
      equal('T02 [MCP] a fresh retry of the losing request then sees duplicate_request', (await loser.call(P + 'fills.request', { rx_id: 'rx-1', store_id: store, quantity: 30, request_id: id + '-retry', expected_version: await s.version() })).status, 'duplicate_request');
    }
    {
      const s = await session('t13', withRx2(structuredClone(minimal)));
      const id = (await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 })).fill.fill_id;
      const start = (await s.snap()).snapshot.data;
      const stored = async () => (await s.snap()).snapshot.data;
      const views = async () => [(await s.read('fills.get', { fill_id: id })).fill, (await s.read('fills.list', {})).fills.find(f => f.fill_id === id)];
      await s.advance('2026-11-30T11:01:00-05:00');
      const [got, listed] = await views();
      equal('T13 [MCP] past its review time fills.get and fills.list give the same ready view', [got.state, listed], ['ready', got]);
      const early = await s.read('fills.cancel.preview', { fill_id: id });
      check('T13 [MCP] a cancel preview returns a token listing the reversal of the paid claim', early.status === 'ok' && early.preview.changes.claim_reversal !== null && early.preview.changes.claim_reversal.claim_id === got.claim.claim_id);
      equal('T13 [MCP] env.snapshot still holds exactly the stored business data after the request', await stored(), start);
      await s.advance('2026-12-10T11:01:00-05:00');
      const [back, backListed] = await views();
      equal('T13 [MCP] past its return deadline both give the same returned_to_stock view with the claim reversed', [back.state, back.claim.reversed_at, backListed], ['returned_to_stock', '2026-12-10T11:00:00-05:00', back]);
      equal('T13 [MCP] a new cancel preview returns invalid_state', (await s.read('fills.cancel.preview', { fill_id: id })).status, 'invalid_state');
      const before = await s.snap();
      equal('T13 [MCP] a cancel confirm with the earlier token, a fresh request ID and the current version is stale_preview', (await s.write('fills.cancel.confirm', { fill_id: id, token: early.preview.token }, 't13-old')).status, 'stale_preview');
      const after = await s.snap();
      equal('T13 [MCP] with exactly one denial audit row of its own and nothing stored', [delta(before, after), after.snapshot.data, after.snapshot.receipts, after.version], [[['agent', P + 'fills.cancel.confirm', 'deny']], before.snapshot.data, before.snapshot.receipts, before.version]);
      equal('T13 [MCP] throughout, env.snapshot holds exactly the stored business data after the request', await stored(), start);
      equal('T13 [MCP] the next fresh successful write commits', (await s.write('fills.request', { rx_id: 'rx-2', store_id: 'st-1', quantity: 30 })).status, 'committed');
      const d = (await s.snap()).snapshot.data, f = d.fills.find(x => x.fill_id === id);
      equal('T13 [MCP] review, warning and return persisted once, each dated at its due time', f.timeline.map(t => [t.state, t.at]), [['requested', NOW], ['ready', '2026-11-30T11:00:00-05:00'], ['returned_to_stock', '2026-12-10T11:00:00-05:00']]);
      equal('T13 [MCP] the warning and the reversal carry their due times', [f.warned_at, d.claims.find(c => c.fill_id === id).reversed_at], ['2026-12-07T11:00:00-05:00', '2026-12-10T11:00:00-05:00']);
      equal('T13 [MCP] their notices once, at their due times', d.notices.slice(start.notices.length).filter(x => x.subject.id === id).map(x => [x.kind, x.recipient_id, x.at]), [
        ['notice.fill_ready', 'p-2', '2026-11-30T11:00:00-05:00'], ['notice.fill_ready', 'p-4', '2026-11-30T11:00:00-05:00'],
        ['notice.return_warning', 'p-2', '2026-12-07T11:00:00-05:00'], ['notice.return_warning', 'p-4', '2026-12-07T11:00:00-05:00'],
        ['notice.returned', 'p-2', '2026-12-10T11:00:00-05:00'], ['notice.returned', 'p-4', '2026-12-10T11:00:00-05:00']]);
      const [persisted, persistedListed] = await views();
      equal('T13 [MCP] the persisted views equal the projected ones, in both reads', [persisted, persistedListed], [back, back]);
      await s.write('fills.set_collector', { fill_id: (await s.read('fills.list', {})).fills.find(x => x.rx_id === 'rx-2').fill_id, collector_id: 'p-4' });
      equal('T13 [MCP] a further write adds nothing for that fill', (await s.snap()).snapshot.data.notices.filter(x => x.subject.id === id).length, 6);
    }
    {
      const s = await session('replay', structuredClone(minimal));
      const args = await s.writeArgs({ rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }, 'replay-req');
      const first = await s.agent.call(P + 'fills.request', args);
      await s.advance('2026-11-30T12:00:00-05:00');
      const before = await s.snap();
      const { duplicate, ...again } = await s.agent.call(P + 'fills.request', args);
      const after = await s.snap();
      check('T21 an exact replay returns the stored receipt marked duplicate', duplicate === true);
      equal('T21 the replayed receipt equals the original', again, first);
      equal('T21 the replay persists no catch-up: stored data, receipts, audit, clock and version unchanged', [after.snapshot.data, after.snapshot.receipts, after.snapshot.audit, after.snapshot.virtual_now, after.version], [before.snapshot.data, before.snapshot.receipts, before.snapshot.audit, before.snapshot.virtual_now, before.version]);
      equal('T21 the stored fill is still requested after the replay', (await s.fill(first.fill.fill_id)).state, 'requested');
    }
    {
      const seed = baseSeed();
      seed.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-3', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null });
      seed.fills.find(f => f.fill_id === 'f-5').authorization_id = 'au-1';
      seed.issued.au = 1;
      const s = await session('w5', seed);
      const pv = await s.read('fills.cancel.preview', { fill_id: 'f-5' });
      equal('W5 [MCP] the prepaid cancel preview lists the claim reversal and the authorization void', [pv.preview.changes.claim_reversal, pv.preview.changes.authorization_void], [{ claim_id: 'cl-4' }, { authorization_id: 'au-1', amount_cents: 1200 }]);
      const args = await s.writeArgs({ fill_id: 'f-5', token: pv.preview.token }, 'w5-cancel');
      const before = await s.snap();
      const first = await s.agent.call(P + 'fills.cancel.confirm', args);
      const committed = await s.snap();
      const { duplicate, ...again } = await s.agent.call(P + 'fills.cancel.confirm', args);
      const replayed = await s.snap();
      check('W5 [MCP] the prepaid cancellation commits and an identical retry returns the original receipt', first.status === 'committed' && duplicate === true);
      equal('W5 [MCP] the replayed receipt equals the original', again, first);
      equal('W5 [MCP] the replay changes no business data, notice, receipt or version', [replayed.snapshot.data, replayed.snapshot.receipts, replayed.version], [committed.snapshot.data, committed.snapshot.receipts, committed.version]);
      const d = committed.snapshot.data, f = d.fills.find(x => x.fill_id === 'f-5'), au = d.authorizations.find(a => a.authorization_id === 'au-1');
      equal('W5 [MCP] the persisted fill is cancelled once at the ready stage, its authorization voided and its claim reversed', [f.state, f.timeline.filter(t => t.state === 'cancelled').length, f.cancellation.stage, au.state, au.ended_at, d.claims.find(c => c.claim_id === 'cl-4').reversed_at], ['cancelled', 1, 'ready', 'voided', NOW, NOW]);
      equal('W5 [MCP] the cancellation wrote the full void entry and the card owner\'s masked entry', d.notices.slice(before.snapshot.data.notices.length).map(x => [x.kind, x.recipient_id, x.audience]), [['notice.payment_voided', 'p-4', 'full'], ['notice.payment_voided', 'p-2', 'card_owner']]);
      const view = (await s.read('fills.get', { fill_id: 'f-5' })).fill;
      equal('W5 [MCP] the terminal fill stays readable in both reads with its voided authorization and reversed claim', [view.state, view.authorization.state, view.claim.reversed_at, view.cancellation.stage, (await s.read('fills.list', {})).fills.find(x => x.fill_id === 'f-5')], ['cancelled', 'voided', NOW, 'ready', view]);
      const terminal = await s.snap();
      const controls = [
        await s.read('fills.cancel.preview', { fill_id: 'f-5' }), await s.read('fills.choose_cash.preview', { fill_id: 'f-5' }), await s.read('fills.prepay.preview', { fill_id: 'f-5', card_id: 'card-3' }),
        await s.write('fills.change_store', { fill_id: 'f-5', store_id: 'st-2' }), await s.write('fills.set_collector', { fill_id: 'f-5', collector_id: 'p-4' }), await s.write('fills.wait', { fill_id: 'f-5' }),
      ].map(x => x.status);
      equal('W5 [MCP] after the cancellation new previews and writes without a confirmation are invalid_state', controls, Array(6).fill('invalid_state'));
      equal('W5 [MCP] the pre-terminal token with a fresh request ID and the current version is stale_preview', (await s.write('fills.cancel.confirm', { fill_id: 'f-5', token: pv.preview.token }, 'w5-again')).status, 'stale_preview');
      const end = await s.snap();
      equal('W5 [MCP] none of these controls changes business data, notices, receipts or the version', [end.snapshot.data, end.snapshot.receipts, end.version], [terminal.snapshot.data, terminal.snapshot.receipts, terminal.version]);
    }
    {
      const s = await session('ignored', structuredClone(minimal));
      const id = (await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 })).fill.fill_id;
      const before = await s.snap();
      const out = await s.event('fill.hold_released', { fill_id: id, note: 'No hold' }, '2026-11-30T11:30:00-05:00', 'ignored-release');
      const after = await s.snap();
      equal('[MCP] a fresh ignored event commits', out.status, 'committed');
      equal('[MCP] it commits the overdue review, the clock, one revision and exactly one allow audit row of its own', [after.snapshot.data.fills.find(f => f.fill_id === id).state, after.snapshot.virtual_now, after.version.revision - before.version.revision, delta(before, after)], ['ready', '2026-11-30T11:30:00-05:00', 1, [['infra', 'env.apply_event', 'allow']]]);
      equal('[MCP] the ignored release adds no notice of its own: the only new entries are the overdue review\'s, at its due time', after.snapshot.data.notices.slice(before.snapshot.data.notices.length).map(n => [n.kind, n.recipient_id, n.subject.id, n.at]), [['notice.fill_ready', 'p-2', id, '2026-11-30T11:00:00-05:00'], ['notice.fill_ready', 'p-4', id, '2026-11-30T11:00:00-05:00']]);
      equal('[MCP] its receipt is the original event response, and every earlier receipt is unchanged', [after.snapshot.receipts['event:ignored-release'].result, omit(after.snapshot.receipts, 'event:ignored-release')], [out, before.snapshot.receipts]);
      const b1 = await s.snap();
      const back = await s.event('fill.hold_placed', { fill_id: id, note: 'Flag' }, '2026-11-30T11:00:00-05:00');
      const b2 = await s.snap();
      const malformed = await s.infra.call('env.apply_event', { expected_version: await s.version(), event: { event_id: 'bad-1', at: '2026-11-30T12:00:00-05:00', operation: 'fill.hold_placed', payload: { fill_id: id } } });
      const end = await s.snap();
      equal('[MCP] a fresh backdated event is invalid_event and a malformed one invalid_arguments', [back.status, malformed.status], ['invalid_event', 'invalid_arguments']);
      equal('[MCP] each adds exactly one denial row of its own', [delta(b1, b2), delta(b2, end)], [[['infra', 'env.apply_event', 'deny']], [['infra', 'env.apply_event', 'deny']]]);
      equal('[MCP] both preserve data, receipts, version and clock', [end.snapshot.data, end.snapshot.receipts, end.version, end.snapshot.virtual_now], [b1.snapshot.data, b1.snapshot.receipts, b1.version, b1.snapshot.virtual_now]);
    }
    {
      const s = await session('rollback', structuredClone(minimal));
      const id = (await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 })).fill.fill_id;
      await s.advance('2026-11-30T11:30:00-05:00');
      const before = await s.snap();
      const failed = await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-2', quantity: 30 }, 'rollback-dup');
      const after = await s.snap();
      equal('[MCP] an App error after catch-up returns its code', failed.status, 'duplicate_request');
      equal('[MCP] the catch-up rolls back: data, notices, receipts, version and clock unchanged, with exactly one denial row of its own', [after.snapshot.data, after.snapshot.receipts, after.version, after.snapshot.virtual_now, delta(before, after), after.snapshot.data.fills.find(f => f.fill_id === id).state], [before.snapshot.data, before.snapshot.receipts, before.version, before.snapshot.virtual_now, [['agent', P + 'fills.request', 'deny']], 'requested']);
      const again = await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-2', quantity: 30 }, 'rollback-dup');
      equal('[MCP] no receipt was stored: the same request ID runs again', [again.status, again.duplicate], ['duplicate_request', undefined]);
      const bundle = structuredClone(before.snapshot.resources.bundle);
      bundle.blobs = { ...bundle.blobs, 'asset-ghost': 'AAAA' };
      const pre = await s.snap();
      const rejected = await s.infra.call('env.apply_event', { expected_version: await s.version(), event: { event_id: 'rollback-bundle', at: '2026-11-30T11:45:00-05:00', operation: 'fill.hold_placed', payload: { fill_id: id, note: 'Flag' } }, bundle });
      const end = await s.snap();
      equal('[MCP] Core rejects the event\'s bundle after the handler ran', rejected.status, 'invalid_bundle');
      equal('[MCP] it rolls back data, notices, receipts, version and clock with exactly one denial row of its own and no receipt', [end.snapshot.data, end.snapshot.receipts, end.version, end.snapshot.virtual_now, delta(pre, end), end.snapshot.receipts['event:rollback-bundle'] ?? null], [pre.snapshot.data, pre.snapshot.receipts, pre.version, pre.snapshot.virtual_now, [['infra', 'env.apply_event', 'deny']], null]);
    }
    {
      const s = await session('t21', structuredClone(minimal));
      equal('T21 an unknown fill is not_found', (await s.read('fills.get', { fill_id: 'f-404' })).status, 'not_found');
      const args = await s.writeArgs({ rx_id: 'rx-1', store_id: 'st-1', quantity: 30 }, 't21-req');
      const first = await s.agent.call(P + 'fills.request', args);
      const { duplicate: replayFlag, ...replay } = await s.agent.call(P + 'fills.request', args);
      check('T21 a repeated request ID returns the stored receipt', first.status === 'committed' && replayFlag === true);
      equal('T21 the replayed request receipt equals the original response', replay, first);
      equal('T21 the same request ID with a changed payload is idempotency_conflict', (await s.agent.call(P + 'fills.request', { ...args, quantity: 90 })).status, 'idempotency_conflict');
      equal('T21 the Agent cannot apply events or reset', [(await s.agent.call('env.apply_event', {})).status, (await s.agent.call('env.reset', {})).status], ['permission_denied', 'permission_denied']);
      const ev = { event_id: 't22-hold', at: '2026-11-30T09:01:00-05:00', operation: 'fill.hold_placed', payload: { fill_id: first.fill.fill_id, note: 'Flag' } };
      const one = await s.infra.call('env.apply_event', { expected_version: await s.version(), event: ev });
      await s.advance('2026-11-30T10:00:00-05:00');
      const stored = await s.snap();
      check('T22 the clock has moved past the event before its replay', stored.snapshot.virtual_now === '2026-11-30T10:00:00-05:00');
      const { duplicate, ...two } = await s.infra.call('env.apply_event', { expected_version: await s.version(), event: ev });
      const later = await s.snap();
      check('T22 a repeated event ID returns the stored receipt', one.status === 'committed' && duplicate === true);
      equal('T22 with no second effect on data, receipts, audit rows, clock or version', [later.snapshot.data, later.snapshot.receipts, later.snapshot.audit, later.snapshot.virtual_now, later.version, later.snapshot.data.fills.find(f => f.fill_id === first.fill.fill_id).notes.length], [stored.snapshot.data, stored.snapshot.receipts, stored.snapshot.audit, stored.snapshot.virtual_now, stored.version, 1]);
      equal('T22 the replayed event receipt equals the original event response and the stored receipt', [two, stored.snapshot.receipts['event:t22-hold'].result], [one, one]);
      const conflict = await s.infra.call('env.apply_event', { expected_version: await s.version(), event: { ...ev, payload: { ...ev.payload, note: 'Changed' } } });
      const after = await s.snap();
      equal('T22 the same event ID with a changed payload is idempotency_conflict, with exactly one denial row and nothing stored', [conflict.status, delta(later, after), after.snapshot.data, after.snapshot.receipts, after.version], ['idempotency_conflict', [['infra', 'env.apply_event', 'deny']], later.snapshot.data, later.snapshot.receipts, later.version]);
    }
    {
      const s = await session('t22-late', baseSeed(), '2026-11-30T11:00:00-05:00');
      const got = (await s.read('fills.get', { fill_id: 'f-1' })).fill;
      equal('T22 a seed loaded after a fill\'s review time: fills.get and fills.list report the same reviewed fill', [got.state, (await s.read('fills.list', {})).fills.find(f => f.fill_id === 'f-1')], ['claim_rejected', got]);
      equal('T22 the stored fill is still requested', (await s.fill('f-1')).state, 'requested');
      const notices = async () => (await s.snap()).snapshot.data.notices;
      const n0 = (await notices()).length;
      await s.write('fills.set_collector', { fill_id: 'f-5', collector_id: 'p-4' });
      const once = await s.fill('f-1');
      const n1 = await notices();
      equal('T22 the first write persists the review\'s two claim-rejection notices, dated at the review time', n1.slice(n0).map(n => [n.kind, n.recipient_id, n.subject.id, n.at]), [['notice.claim_rejected', 'p-2', 'f-1', '2026-11-30T10:30:00-05:00'], ['notice.claim_rejected', 'p-4', 'f-1', '2026-11-30T10:30:00-05:00']]);
      await s.write('fills.set_collector', { fill_id: 'f-5', collector_id: null });
      const twice = await s.fill('f-1');
      equal('T22 the second write adds no notice', (await notices()).slice(n1.length), []);
      equal('T22 the first fresh successful write persists the review once', [once.state, once.timeline.length, twice.timeline.length, (await s.snap()).snapshot.data.claims.filter(c => c.fill_id === 'f-1').length], ['claim_rejected', 2, 2, 1]);
    }
    {
      const LOADED = '2026-11-29T15:00:00-05:00';
      const s = await session('reset', structuredClone(minimal), LOADED);
      const seedState = (await s.snap()).snapshot;
      const id = (await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 })).fill.fill_id;
      const pv = await s.read('grants.change.preview', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view' });
      await s.event('user.confirmed', { token: pv.preview.token, confirmed_by: 'p-2' });
      check('T22 the approval is stored before the reset', (await s.snap()).snapshot.data.approvals.length === 1);
      await s.advance('2026-11-30T12:00:00-05:00');
      const old = await s.version();
      check('T22 the clock was advanced before the reset', (await s.snap()).snapshot.virtual_now === '2026-11-30T12:00:00-05:00' && old.revision > 0);
      equal('T22 reset is ready', (await s.infra.call('env.reset', { expected_version: old })).status, 'ready');
      const back = await s.snap();
      equal('T22 reset restores the loaded seed and its loaded virtual time, not the fixture clock; approvals and the fill are gone', [back.snapshot.data, back.snapshot.virtual_now, back.snapshot.data.approvals.length, LOADED === NOW], [seedState.data, LOADED, 0, false]);
      equal('T22 reset keeps no pre-reset receipt or audit row, only the reset itself, at a new epoch', [back.snapshot.receipts, back.snapshot.audit.map(a => [a.tool, a.decision]), back.version], [{}, [['env.reset', 'allow']], { epoch: old.epoch + 1, revision: 0 }]);
      for (let i = 1; i <= old.revision; i++) await s.advance(new Date(Date.parse(LOADED) + i * 60000).toISOString());
      const current = await s.version();
      equal('T22 the new epoch reaches the pre-reset revision', [current.epoch, current.revision], [old.epoch + 1, old.revision]);
      equal('T22 a write with the pre-reset epoch at an equal revision is stale_version', (await s.agent.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30, request_id: 'reset-old', expected_version: old })).status, 'stale_version');
      equal('T22 an unseen event with the pre-reset epoch at an equal revision is stale_version', (await s.infra.call('env.apply_event', { expected_version: old, event: { event_id: 'reset-old-ev', at: (await s.snap()).snapshot.virtual_now, operation: 'store.restocked', payload: { store_id: 'st-2', drug_id: 'd-atorvastatin-40' } } })).status, 'stale_version');
      equal('T22 the same write with the current epoch commits', (await s.agent.call(P + 'fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30, request_id: 'reset-new', expected_version: current })).status, 'committed');
      equal('T22 after reset the grant confirm needs a new approval', (await s.write('grants.change.confirm', { action: 'grant', patient_id: 'p-2', grantee_id: 'p-1', scope: 'view', token: pv.preview.token })).status, 'confirmation_required');
      check('T22 the reset fill ID was free again and reissued to the new request', (await s.snap()).snapshot.data.fills.map(f => f.fill_id).join() === id);
    }
    {
      const s = await session('t22-pa', pa(structuredClone(minimal)));
      const id = (await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 })).fill.fill_id;
      await s.advance('2026-11-30T11:30:00-05:00');
      await s.event('fill.hold_placed', { fill_id: id, note: 'Interaction flag' });
      const token = (await s.read('fills.cancel.preview', { fill_id: id })).preview.token;
      const held = (await s.fill(id)).fill_version;
      equal('T22 reset to the same seed is ready', (await s.infra.call('env.reset', { expected_version: await s.version() })).status, 'ready');
      await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-1', quantity: 30 });
      await s.advance('2026-11-30T11:30:00-05:00');
      const pr = await s.write('plan_requests.create', { fill_id: id });
      equal('T22 a plan request brings the fill back to the previewed version', (await s.fill(id)).fill_version, held);
      equal('T22 the old cancel token with the current Core version is stale_preview', (await s.write('fills.cancel.confirm', { fill_id: id, token })).status, 'stale_preview');
      equal('T22 the plan request stays pending', (await s.snap()).snapshot.data.plan_requests.find(r => r.plan_request_id === pr.plan_request.plan_request_id).state, 'pending');
    }
    {
      const s = await session('t22-cash', pa(structuredClone(minimal)));
      const id = (await s.write('fills.request', { rx_id: 'rx-1', store_id: 'st-2', quantity: 30 })).fill.fill_id;
      await s.advance('2026-11-30T11:30:00-05:00');
      const pv = await s.read('fills.choose_cash.preview', { fill_id: id });
      await s.event('store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' });
      const now = await s.read('fills.choose_cash.preview', { fill_id: id });
      equal('T22 the restock changes the cash preview\'s resulting status', [pv.preview.changes.resulting_state, now.preview.changes.resulting_state], ['waiting_stock', 'ready']);
      equal('T22 the cash token reused after the restock is stale_preview', (await s.write('fills.choose_cash.confirm', { fill_id: id, token: pv.preview.token })).status, 'stale_preview');
    }
    {
      const s = await session('seeds', structuredClone(minimal));
      const before = await s.snap();
      const bad = structuredClone(minimal);
      bad.approvals = [{ approval_id: 'ap-1', token: 'tok-7c1e', subject: null, confirmed_by: 'p-2', confirmed_at: NOW, used_at: null }];
      bad.issued.ap = 1;
      equal('[MCP] a seed carrying an approval is invalid_plugin_result', (await s.infra.call('env.load_seed', { expected_version: await s.version(), data: bad, request_id: 'seed-approval' })).status, 'invalid_plugin_result');
      const after = await s.snap();
      equal('[MCP] with exactly one denial row of its own and prior data, version and receipts unchanged', [delta(before, after), after.snapshot.data, after.version, after.snapshot.receipts], [[['infra', 'env.load_seed', 'deny']], before.snapshot.data, before.version, before.snapshot.receipts]);
      for (const [label, edit] of [['a price', d => { delete d.cash_prices['d-atorvastatin-40']['30']; }], ['a plan rule', d => { delete d.plans[1].rules['d-atorvastatin-40']; }], ['a drug', d => { d.drugs = d.drugs.filter(x => x.drug_id !== 'd-atorvastatin-40'); }], ['a fact source', d => { delete d.drugs[0].facts[0].source; }]]) {
        const data = structuredClone(minimal);
        edit(data);
        equal('[MCP] a schema-valid seed missing ' + label + ' is invalid_seed', (await s.infra.call('env.load_seed', { expected_version: await s.version(), data, request_id: 'seed-missing-' + label.replace(/ /g, '-') })).status, 'invalid_seed');
      }
      const token = (await s.read('fills.cancel.preview', { fill_id: 'f-404' })).status;
      equal('T21 an unknown fill preview is not_found', token, 'not_found');
    }
    {
      const s = await session('seed-id', baseSeed());
      const pv = await s.read('fills.cancel.preview', { fill_id: 'f-5' });
      const other = baseSeed();
      other.seed_id = 'mendwell-base-2';
      equal('T22 a seed with another seed ID loads', (await s.infra.call('env.load_seed', { expected_version: await s.version(), data: other, request_id: 'seed-id-2' })).status, 'ready');
      equal('T22 a cancel token previewed under a different seed is stale_preview', (await s.write('fills.cancel.confirm', { fill_id: 'f-5', token: pv.preview.token })).status, 'stale_preview');
    }
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

main().then(() => {
  const report = { schema: 'mendwell.mcp-integration.v1', runtime: require(path.join(runtimeDir, 'package.json')).version, node: process.version, checks, passed: true };
  if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); }
  console.log('mcp integration passed ' + checks.length + ' checks');
}, error => {
  if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify({ schema: 'mendwell.mcp-integration.v1', checks, passed: false, error: error.message }, null, 2) + '\n'); }
  console.error(error.message);
  process.exit(1);
});
