#!/usr/bin/env node
'use strict';
// Real-host workflow check: drives this package through the public runtime with separate
// Agent and Infra stdio MCP processes. Needs a public PALE checkout (or PALE_RUNTIME_ROOT);
// App-only tests live in ../business.test.cjs. State is written to a temporary directory.
// Usage: node tests/mcp/workflows.cjs [report.json]
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const appDir = path.resolve(__dirname, '../..');
let runtime = process.env.PALE_RUNTIME_ROOT;
if (!runtime) {
  let root = appDir;
  while (!fs.existsSync(path.join(root, 'runtime/launch.cjs'))) {
    const parent = path.dirname(root);
    if (parent === root) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
    root = parent;
  }
  runtime = path.join(root, 'runtime');
}
const {prepare} = require(path.join(runtime, 'prepare.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const APP = require('../../app.json').app_id;
const T = name => APP + '.' + name;

(async () => {
  const prepared = prepare(appDir), clients = [], checks = [];
  const stateDir = path.join(prepared.root, 'state');
  const check = (name, condition) => { assert.ok(condition, name); checks.push({name, status: 'passed'}); };
  async function open(role, run, options = {}) {
    const client = new Client(APP, role, run, stateDir, 'parcel-workflow-check', {registry: prepared.registry, ...options});
    clients.push(client);
    await client.initialize();
    return client;
  }
  let eventSeq = 0;
  const event = (operation, at, payload) => ({event_id: 'mcp-evt-' + (++eventSeq), at, operation: 'parcel.' + operation, payload});
  const report = {schema: 'parcel-delivery-manager.mcp-workflows.v1', app_id: APP, app_version: require('../../app.json').version,
    runtime_version: require(path.join(runtime, 'package.json')).version, node: process.version, checks, passed: false};
  try {
    // ---- Restricted profile: reads work, writes are denied by Core policy ----
    const restrictedInfra = await open('infra', 'restricted');
    const restricted = await open('agent', 'restricted');
    const look = await restricted.call(T('change.preview'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06'});
    check('Scenario profile can preview', look.status === 'ok' && look.preview.allowed);
    const denied = await restricted.call(T('change.submit'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06',
      confirmation: look.preview.confirmation, expected_version: look.version, request_id: 'restricted-1'});
    check('Scenario profile cannot submit a change', denied.status === 'permission_denied');
    check('Denied write leaves no request', (await restrictedInfra.call('env.snapshot')).snapshot.data.changes.length === 1);

    // ---- Sandbox profile: W1 through real MCP ----
    const infra = await open('infra', 'main', {initialProfile: 'sandbox'});
    const agent = await open('agent', 'main');
    const baseline = (await infra.call('env.snapshot')).snapshot.data;
    const preview = await agent.call(T('change.preview'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06'});
    check('Preview is a read: no version change', JSON.stringify(preview.version) === JSON.stringify((await infra.call('env.snapshot')).version));
    const submitArgs = {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06', confirmation: preview.preview.confirmation, expected_version: preview.version, request_id: 'w1-submit'};
    const submitted = await agent.call(T('change.submit'), submitArgs);
    check('Submission commits a pending request', submitted.status === 'committed' && submitted.change_status === 'pending');
    let snap = await infra.call('env.snapshot');
    check('Committed state holds exactly the new pending request', snap.snapshot.data.changes.filter(x => x.status === 'pending').length === 1 &&
      snap.snapshot.data.shipments.find(s => s.id === 'S001').plan.revision === 1);
    const retried = await agent.call(T('change.submit'), submitArgs);
    check('Identical retry returns the original receipt', retried.duplicate === true && retried.change_id === submitted.change_id);
    check('Retry has one business effect', (await infra.call('env.snapshot')).snapshot.data.changes.length === 2);
    const conflict = await agent.call(T('change.submit'), {...submitArgs, delivery_date: '2026-03-07'});
    check('Same request ID with a changed payload is rejected', conflict.status === 'idempotency_conflict');
    const stale = await agent.call(T('change.cancel'), {id: submitted.change_id, expected_version: preview.version, request_id: 'w1-stale-cancel'});
    check('Stale version cannot write', stale.status === 'stale_version');

    // Physical state and decisions are out of the Agent's reach.
    for (const name of ['env.apply_event', 'env.advance_time', 'env.load_seed', 'env.reset', 'env.snapshot']) {
      check('Agent cannot call ' + name, (await agent.call(name, {})).status === 'permission_denied');
    }
    const tools = (await agent.request('tools/list')).result.tools.map(t => t.name);
    // The Agent surface is exactly the declared business tools; none of them takes an event or a physical outcome.
    check('Agent tools are exactly the declared business tools', JSON.stringify(tools.sort()) === JSON.stringify(require('../../tools.json').map(t => t.name).sort()));

    snap = await infra.call('env.snapshot');
    const decided = await infra.call('env.apply_event', {expected_version: snap.version,
      event: event('change_resolved', '2026-03-02T16:00:00Z', {shipment_id: 'S001', change_id: submitted.change_id, base_plan_revision: 1, decision: 'applied', reason: null})});
    check('Carrier decision commits through Infra', decided.status === 'committed');
    const after = await agent.call(T('shipments.get'), {id: 'S001'});
    check('Agent reads the applied plan', after.shipment.plan.revision === 2 && after.shipment.plan.delivery_date === '2026-03-06' && after.shipment.pending_change === null);
    const lateCancel = await agent.call(T('change.cancel'), {id: submitted.change_id, expected_version: after.version, request_id: 'w1-late-cancel'});
    check('Cancelling after the decision is too_late', lateCancel.status === 'too_late');
    const oldDecision = await infra.call('env.apply_event', {expected_version: after.version,
      event: event('delivered', '2026-03-02T17:00:00Z', {shipment_id: 'S001', plan_revision: 1})});
    check('Event for a superseded plan is rejected', oldDecision.status === 'invalid_event');
    check('Rejected event did not move the clock or data', JSON.stringify((await infra.call('env.snapshot')).version) === JSON.stringify(after.version));

    // ---- Clock-only advance (env.advance_time): no handler runs, deadlines still bind ----
    snap = await infra.call('env.snapshot');
    const beforeClock = snap.snapshot.data;
    const advanced = await infra.call('env.advance_time', {request_id: 'to-pickup-deadline', expected_version: snap.version, virtual_now: '2026-03-04T15:00:00Z'});
    check('Infra advances the clock', advanced.status === 'committed' && advanced.advanced === true);
    snap = await infra.call('env.snapshot');
    check('Advancing time changes no business record', JSON.stringify(snap.snapshot.data) === JSON.stringify(beforeClock));
    const expired = await agent.call(T('pass.get'), {id: 'S002'});
    check('Pass is invalid at its exact expiry although no event ran', expired.pass.valid_now === false);
    const gap = await agent.call(T('change.preview'), {id: 'S002', kind: 'redirect', point_id: 'P03'});
    check('Changes are refused after the deadline passes by the clock', gap.preview.allowed === false && gap.preview.reason === 'deadline_passed');
    check('Parcel status is unchanged in the gap', (await agent.call(T('shipments.get'), {id: 'S002'})).shipment.status === 'at_pickup');

    // ---- Reset restores the loaded baseline, including credentials and clock ----
    const reset = await infra.call('env.reset', {expected_version: snap.version});
    check('Reset returns ready', reset.status === 'ready');
    snap = await infra.call('env.snapshot');
    check('Reset restores business records', JSON.stringify(snap.snapshot.data) === JSON.stringify(baseline));
    check('Reset restores the clock', Date.parse(snap.snapshot.virtual_now) === Date.parse(require('../../fixtures/clock.json').initial_time));
    check('Pass is valid again after reset', (await agent.call(T('pass.get'), {id: 'S002'})).pass.valid_now === true);

    // ---- W2: two competing handoffs on one parcel ledger ----
    const collected = at => event('collected', at, {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: 'K7QM-4R2X'});
    const second = await open('infra', 'main');
    const [a, b] = await Promise.all([
      infra.call('env.apply_event', {expected_version: snap.version, event: collected('2026-03-03T15:00:00Z')}),
      second.call('env.apply_event', {expected_version: snap.version, event: collected('2026-03-03T15:00:00Z')})
    ]);
    const outcomes = [a.status, b.status].sort();
    check('Exactly one of two concurrent handoffs commits', outcomes[0] === 'committed' && outcomes[1] === 'stale_version');
    snap = await infra.call('env.snapshot');
    const again = await infra.call('env.apply_event', {expected_version: snap.version, event: collected('2026-03-03T15:05:00Z')});
    check('A later handoff with a fresh version is still rejected', again.status === 'invalid_event');
    snap = await infra.call('env.snapshot');
    check('Parcel was collected once and its pass consumed once', snap.snapshot.data.shipments.find(s => s.id === 'S002').status === 'collected' &&
      snap.snapshot.data.passes.filter(p => p.status === 'consumed').length === 1);
    const gone = await agent.call(T('pass.get'), {id: 'S002'});
    check('Collected parcel has no pass', gone.status === 'not_available');

    // ---- Task policy can limit a write to one parcel through the standard `id` constraint ----
    const policies = structuredClone(snap.snapshot.policies);
    policies.sandbox.constraints[T('change.submit')] = {ids: ['S003']};
    const loaded = await infra.call('env.load_seed', {expected_version: snap.version, request_id: 'constrained', data: baseline, binding: snap.snapshot.binding, policies});
    check('Infra loads history with a task policy and no resource bundle', loaded.status === 'ready' && loaded.loaded === baseline.shipments.length);
    const p1 = await agent.call(T('change.preview'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06'});
    const outside = await agent.call(T('change.submit'), {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06', confirmation: p1.preview.confirmation, expected_version: p1.version, request_id: 'constrained-1'});
    check('Write outside the permitted parcel is denied by Core', outside.status === 'permission_denied');
    const p3 = await agent.call(T('change.preview'), {id: 'S003', kind: 'redirect', point_id: 'P03'});
    const inside = await agent.call(T('change.submit'), {id: 'S003', kind: 'redirect', point_id: 'P03', confirmation: p3.preview.confirmation, expected_version: p3.version, request_id: 'constrained-2'});
    check('Write on the permitted parcel commits', inside.status === 'committed');

    report.passed = true;
  } catch (e) {
    report.error = e.message;
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
  if (process.argv[2]) { fs.mkdirSync(path.dirname(path.resolve(process.argv[2])), {recursive: true}); fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n'); }
  console.log(checks.map(c => 'PASS ' + c.name).join('\n'));
  console.log(report.passed ? '\n' + checks.length + ' real-MCP workflow checks passed.' : '\nFAILED: ' + report.error);
  if (!report.passed) process.exitCode = 1;
})();
