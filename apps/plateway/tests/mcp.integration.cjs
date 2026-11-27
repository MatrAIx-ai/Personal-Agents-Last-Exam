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

const checks = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push({ name, status: 'passed' }); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, status: 'passed' }); };
const CHECKOUT = { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 300 };

async function main() {
  const prepared = prepare(appDir);
  const clients = [];
  const open = async (role, run) => {
    const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'plateway-mcp-check', { registry: prepared.registry });
    clients.push(c);
    await c.initialize();
    return c;
  };
  const session = async run => {
    const infra = await open('infra', run), agent = await open('agent', run);
    let n = 0;
    const snap = () => infra.call('env.snapshot');
    const version = async () => (await snap()).version;
    const writeArgs = async (args, id) => ({ ...args, request_id: id || run + '-w' + (++n), expected_version: await version() });
    const write = async (name, args, id) => agent.call(name, await writeArgs(args, id));
    const read = (name, args = {}) => agent.call(name, args);
    const advance = async at => infra.call('env.advance_time', { expected_version: await version(), virtual_now: at, request_id: run + '-t' + (++n) });
    const event = async e => infra.call('env.apply_event', { expected_version: await version(), event: e });
    const order = async id => (await snap()).snapshot.data.orders.find(o => o.id === id);
    return { infra, agent, snap, version, writeArgs, write, read, advance, event, order };
  };
  const denials = s => s.snapshot.audit.filter(a => a.decision === 'deny').length;

  try {
    equal('The package wire schema is byte-identical to the runtime contract', fs.readFileSync(path.join(appDir, 'schemas/router-message.schema.json')), fs.readFileSync(path.join(runtimeDir, 'contracts/schemas/router-message.schema.json')));
    {
      const s = await session('t04');
      await s.write('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-2'], quantity: 1 });
      const preview = await s.read('plateway.checkout.preview', CHECKOUT);
      const args = await s.writeArgs({ ...CHECKOUT, token: preview.token }, 't04-place');
      const first = await s.agent.call('plateway.orders.place', args);
      const again = await s.agent.call('plateway.orders.place', args);
      check('T04 placement commits', first.status === 'committed' && first.order_id === 'o-13');
      check('T04 the same request ID returns the stored receipt', again.duplicate === true && again.order_id === first.order_id);
      const data = (await s.snap()).snapshot.data;
      equal('T04 one order and one charge', data.orders.filter(o => o.id === 'o-13').map(o => o.charge.amount_cents), [preview.total_cents]);
    }
    {
      const s = await session('t07');
      const original = await s.read('plateway.orders.cancel.preview', { order_id: 'o-12' });
      check('T07 a cancel token for the scheduled order', original.status === 'ok');
      const start = (await s.snap()).snapshot.data;
      const counts = async () => { const d = (await s.snap()).snapshot.data; return [d.orders.find(o => o.id === 'o-12').status, d.orders.find(o => o.id === 'o-12').refunds.length, d.notices.length]; };
      const listed = async () => (await s.read('plateway.orders.list', {})).orders.find(o => o.id === 'o-12').status;
      await s.advance('2026-11-18T18:46:00-05:00');
      equal('T07 one minute after release orders.get shows submitted', (await s.read('plateway.orders.get', { order_id: 'o-12' })).order.status, 'submitted');
      equal('T07 one minute after release orders.list shows submitted', await listed(), 'submitted');
      const fresh = await s.read('plateway.orders.cancel.preview', { order_id: 'o-12' });
      check('T07 a new cancel preview yields a new token', fresh.status === 'ok' && fresh.token !== original.token);
      equal('T07 the original token with a fresh request and the current version is stale', (await s.write('plateway.orders.cancel.confirm', { order_id: 'o-12', token: original.token })).status, 'stale_preview');
      equal('T07 the stored order, refunds and notices are unchanged after release', await counts(), ['scheduled', 0, start.notices.length]);
      await s.advance('2026-11-18T19:06:00-05:00');
      const projected = (await s.read('plateway.orders.get', { order_id: 'o-12' })).order;
      equal('T07 21 minutes after release orders.get shows cancelled, not accepted, with the full refund', [projected.status, projected.cancellation.reason, projected.refunded_cents], ['cancelled', 'not_accepted', projected.charge.amount_cents]);
      equal('T07 21 minutes after release orders.list shows cancelled', await listed(), 'cancelled');
      equal('T07 the cancel preview is invalid_state', (await s.read('plateway.orders.cancel.preview', { order_id: 'o-12' })).status, 'invalid_state');
      equal('T07 a confirm of the new token is invalid_state', (await s.write('plateway.orders.cancel.confirm', { order_id: 'o-12', token: fresh.token })).status, 'invalid_state');
      equal('T07 the stored order, refunds and notices are still unchanged', await counts(), ['scheduled', 0, start.notices.length]);
      equal('T07 a fresh cart write commits', (await s.write('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-1'], quantity: 1 })).status, 'committed');
      const stored = await s.order('o-12');
      const data = (await s.snap()).snapshot.data;
      equal('T07 both transitions persist with one full refund', [stored.status, stored.refunds.map(r => r.amount_cents)], ['cancelled', [stored.charge.amount_cents]]);
      equal('T07 one cancellation notice dated release + 20 minutes', data.notices.slice(start.notices.length).map(n => [n.kind, n.order_id, n.at]), [['notice.order_cancelled', 'o-12', '2026-11-18T19:05:00-05:00']]);
      equal('T07 the release is dated at its time', stored.timeline.filter(t => t.note === 'Released to the restaurant').map(t => t.at), ['2026-11-18T18:45:00-05:00']);
    }
    {
      const s = await session('t06');
      await s.write('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-1'], quantity: 1 });
      const preview = await s.read('plateway.checkout.preview', CHECKOUT);
      const placed = await s.write('plateway.orders.place', { ...CHECKOUT, token: preview.token });
      equal('T06 the acceptance limit is 20 minutes after submission', (await s.order(placed.order_id)).accept_by, '2026-11-18T12:20:00-05:00');
      equal('T06 an acceptance at exactly the limit commits', (await s.event({ event_id: 't06-accept', at: '2026-11-18T12:20:00-05:00', operation: 'order.accepted', payload: { order_id: placed.order_id } })).status, 'committed');
      const stored = await s.order(placed.order_id);
      equal('T06 the timer applies first: cancelled, not accepted, one full refund', [stored.status, stored.cancellation.reason, stored.refunds.map(r => r.amount_cents)], ['cancelled', 'not_accepted', [stored.charge.amount_cents]]);
    }
    {
      const s = await session('t09');
      const late = await s.event({ event_id: 't09-late', at: '2026-11-18T12:10:00-05:00', operation: 'order.accepted', payload: { order_id: 'o-5' } });
      const after = await s.snap();
      check('T09 a late acceptance commits at its at', late.status === 'committed' && after.snapshot.virtual_now === '2026-11-18T12:10:00-05:00');
      equal('T09 the cancelled order stays cancelled', after.snapshot.data.orders.find(o => o.id === 'o-5').status, 'cancelled');
      const unknown = await s.event({ event_id: 't09-unknown', at: '2026-11-18T12:11:00-05:00', operation: 'order.accepted', payload: { order_id: 'o-404' } });
      const back = await s.event({ event_id: 't09-back', at: '2026-11-18T12:05:00-05:00', operation: 'order.accepted', payload: { order_id: 'o-11' } });
      const end = await s.snap();
      equal('T09 unknown-target and back-dated events are invalid_event', [unknown.status, back.status], ['invalid_event', 'invalid_event']);
      equal('T09 data, notices, version and clock are preserved', [end.snapshot.data, end.version, end.snapshot.virtual_now], [after.snapshot.data, after.version, after.snapshot.virtual_now]);
      equal('T09 one denial audit row each', denials(end) - denials(after), 2);
    }
    {
      const s = await session('t11');
      const cancel = await s.read('plateway.orders.cancel.preview', { order_id: 'o-11' });
      const args = await s.writeArgs({ order_id: 'o-11', token: cancel.token }, 't11-cancel');
      const first = await s.agent.call('plateway.orders.cancel.confirm', args);
      const again = await s.agent.call('plateway.orders.cancel.confirm', args);
      check('T11 cancellation commits', first.status === 'committed');
      const { duplicate, ...replayed } = again;
      check('T11 an identical retry returns the stored receipt', duplicate === true);
      equal('T11 the replayed receipt equals the original', replayed, first);
      equal('T11 one refund', (await s.order('o-11')).refunds.length, 1);
    }
    {
      const s = await session('t15');
      equal('T15 an unknown order is not_found', (await s.read('plateway.orders.get', { order_id: 'o-404' })).status, 'not_found');
      const args = await s.writeArgs({ item_id: 'mi-1', option_ids: ['op-1'], quantity: 1 }, 't15-add');
      const first = await s.agent.call('plateway.cart.add_item', args);
      check('T15 a repeated request ID returns the stored receipt', (await s.agent.call('plateway.cart.add_item', args)).duplicate === true && first.status === 'committed');
      equal('T15 the same request ID with different arguments conflicts', (await s.agent.call('plateway.cart.add_item', { ...args, quantity: 2 })).status, 'idempotency_conflict');
      const before = await s.snap();
      equal('T15 a failing write is rejected', (await s.write('plateway.cart.add_item', { item_id: 'mi-1', option_ids: [], quantity: 1 })).status, 'invalid_option');
      const after = await s.snap();
      equal('T15 a failed call preserves data and version', [after.snapshot.data, after.version], [before.snapshot.data, before.version]);
      equal('T15 the Agent cannot apply events or reset', [(await s.agent.call('env.apply_event', {})).status, (await s.agent.call('env.reset', {})).status], ['permission_denied', 'permission_denied']);
    }
    {
      const s = await session('t16');
      const start = await s.snap(), seed = start.snapshot;
      const ev = { event_id: 't16-pause', at: '2026-11-18T12:15:00-05:00', operation: 'restaurant.status_changed', payload: { restaurant_id: 'r-1', status: 'paused', reason: 'Kitchen closed for repairs' } };
      const eventArgs = { expected_version: start.version, event: ev, bundle: structuredClone(seed.resources.bundle) };
      equal('T16 the event commits', (await s.infra.call('env.apply_event', eventArgs)).status, 'committed');
      const firstEvent = (await s.infra.call('env.event_status', { event_id: ev.event_id })).receipt;
      const { duplicate: eventDuplicate, ...replayedEvent } = await s.infra.call('env.apply_event', eventArgs);
      check('T16 an identical event and bundle under the same event ID are deduplicated', eventDuplicate === true);
      equal('T16 the replayed event receipt equals the original', replayedEvent, firstEvent);
      equal('T16 changed content under the same event ID conflicts', (await s.infra.call('env.apply_event', { ...eventArgs, expected_version: await s.version(), event: { ...ev, at: '2026-11-18T12:20:00-05:00' } })).status, 'idempotency_conflict');
      await s.write('plateway.cart.add_item', { item_id: 'mi-2', option_ids: ['op-7', 'op-10'], quantity: 1 });
      const old = await s.version();
      equal('T16 reset is ready', (await s.infra.call('env.reset', { expected_version: old })).status, 'ready');
      const reset = (await s.snap()).snapshot;
      equal('T16 reset restores the seed, the cart and virtual time', [reset.data, reset.data.cart, reset.virtual_now], [seed.data, seed.data.cart, seed.virtual_now]);
      equal('T16 a write with a pre-reset version is stale', (await s.agent.call('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-1'], quantity: 1, request_id: 't16-old', expected_version: old })).status, 'stale_version');
      await s.write('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-1'], quantity: 1 });
      const preview = await s.read('plateway.checkout.preview', CHECKOUT);
      const other = structuredClone((await s.snap()).snapshot.data);
      other.seed_id = 'plateway-minimal-2';
      equal('T16 a seed with another seed ID loads', (await s.infra.call('env.load_seed', { expected_version: await s.version(), data: other, request_id: 't16-seed-2' })).status, 'ready');
      equal('T16 a checkout token previewed under a different seed is stale', (await s.write('plateway.orders.place', { ...CHECKOUT, token: preview.token })).status, 'stale_preview');
    }
    {
      const s = await session('t16-late');
      const fixture = (await s.snap()).snapshot.data;
      equal('T16 the fixture loads five minutes after the scheduled release', (await s.infra.call('env.load_seed', { expected_version: await s.version(), data: fixture, virtual_now: '2026-11-18T18:50:00-05:00', request_id: 't16-seed-late' })).status, 'ready');
      equal('T16 reads show the release', (await s.read('plateway.orders.get', { order_id: 'o-12' })).order.status, 'submitted');
      equal('T16 the stored order is still scheduled', (await s.order('o-12')).status, 'scheduled');
      await s.write('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-1'], quantity: 1 });
      const once = await s.order('o-12');
      await s.write('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-2'], quantity: 1 });
      const twice = await s.order('o-12');
      equal('T16 at the same virtual time the next cart write persists the release once', [once.status, once.accept_by, once.timeline.filter(t => t.note === 'Released to the restaurant').length, twice.timeline.length], ['submitted', '2026-11-18T19:05:00-05:00', 1, once.timeline.length]);
      equal('T16 the clock did not move', (await s.snap()).snapshot.virtual_now, '2026-11-18T18:50:00-05:00');
      await s.advance('2026-11-18T20:00:00-05:00');
      equal('T16 reset is ready after the clock moved', (await s.infra.call('env.reset', { expected_version: await s.version() })).status, 'ready');
      const back = (await s.snap()).snapshot;
      equal('T16 reset restores the loaded seed and the virtual time given at load', [back.data, back.virtual_now], [fixture, '2026-11-18T18:50:00-05:00']);
    }
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

main().then(() => {
  const report = { schema: 'plateway.mcp-integration.v1', runtime: require(path.join(runtimeDir, 'package.json')).version, node: process.version, checks, passed: true };
  if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); }
  console.log('mcp integration passed ' + checks.length + ' checks');
}, error => {
  if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify({ schema: 'plateway.mcp-integration.v1', checks, passed: false, error: error.message }, null, 2) + '\n'); }
  console.error(error.message);
  process.exit(1);
});
