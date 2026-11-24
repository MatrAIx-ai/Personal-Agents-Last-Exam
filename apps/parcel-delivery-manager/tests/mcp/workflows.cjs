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
  const event = (operation, at, payload) => ({event_id: 'mcp-evt-' + (++eventSeq), at, operation: 'carrier.' + operation, payload});
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
    const gapGrant = await agent.call(T('grant.preview'), {id: 'S002', collector_person_id: 'person-alex', expires_at: '2026-03-04T18:00:00Z'});
    check('Authorizing a collector is refused after the deadline passes by the clock', gapGrant.preview.allowed === false && gapGrant.preview.reason === 'deadline_passed');
    const forcedGrant = await agent.call(T('grant.create'), {id: 'S002', collector_person_id: 'person-alex', expires_at: '2026-03-04T18:00:00Z', confirmation: 'cf-guess',
      expected_version: gapGrant.version, request_id: 'gap-grant'});
    check('Creating an authorization in the gap fails with deadline_passed and writes nothing', forcedGrant.status === 'deadline_passed' &&
      (await infra.call('env.snapshot')).snapshot.data.grants.length === 0);

    // ---- Reset restores the loaded baseline, including credentials and clock ----
    const reset = await infra.call('env.reset', {expected_version: snap.version});
    check('Reset returns ready', reset.status === 'ready');
    snap = await infra.call('env.snapshot');
    check('Reset restores business records', JSON.stringify(snap.snapshot.data) === JSON.stringify(baseline));
    check('Reset restores the clock', Date.parse(snap.snapshot.virtual_now) === Date.parse(require('../../fixtures/clock.json').initial_time));
    check('Pass is valid again after reset', (await agent.call(T('pass.get'), {id: 'S002'})).pass.valid_now === true);

    // ---- W3 through real MCP: authorize a collector, with retry ----
    const grantPreview = await agent.call(T('grant.preview'), {id: 'S002', collector_person_id: 'person-alex', expires_at: '2026-03-04T12:00:00Z'});
    check('Grant preview is allowed and is a read', grantPreview.preview.allowed === true && JSON.stringify(grantPreview.version) === JSON.stringify(snap.version));
    const grantArgs = {id: 'S002', collector_person_id: 'person-alex', expires_at: '2026-03-04T12:00:00Z', confirmation: grantPreview.preview.confirmation,
      expected_version: grantPreview.version, request_id: 'w3-grant'};
    const granted = await agent.call(T('grant.create'), grantArgs);
    check('Authorization commits and issues the collector a pass', granted.status === 'committed' && granted.grant_id === 'G001' && granted.pass_id === 'PASS002');
    check('Retried authorization returns the original receipt', (await agent.call(T('grant.create'), grantArgs)).duplicate === true);
    const redirect = await agent.call(T('change.preview'), {id: 'S001', kind: 'redirect', point_id: 'P03'});
    const pendingChange = await agent.call(T('change.submit'), {id: 'S001', kind: 'redirect', point_id: 'P03', confirmation: redirect.preview.confirmation,
      expected_version: redirect.version, request_id: 'w3-change'});
    snap = await infra.call('env.snapshot');
    // History with one live grant, two passes and one pending request, used as a Task seed below.
    const history = snap.snapshot.data, historyTime = snap.snapshot.virtual_now;
    check('One authorization and one pending request are committed', history.grants.length === 1 && history.passes.filter(p => p.status === 'active').length === 2 &&
      history.changes.filter(x => x.status === 'pending').length === 1);

    // ---- Separate seeded runs: the collector and an unauthorized person over the same ledger ----
    const binding = require('../../fixtures/binding.json');
    const ledgerFor = (account_id, owner_person_id) => {
      const data = structuredClone(history);
      for (const key of ['shipments', 'changes', 'grants', 'passes', 'notices']) data[key] = data[key].map(x => ({...x, account_id}));
      return {...data, account_id, owner_person_id};
    };
    async function seededRun(run, account, person) {
      const admin = await open('infra', run, {initialProfile: 'sandbox'});
      const version = (await admin.call('env.snapshot')).version, data = ledgerFor(account, person);
      // The acting account comes from a trusted binding supplied by Infra, never from the seed alone.
      const unbound = await admin.call('env.load_seed', {expected_version: version, data, virtual_now: historyTime});
      check('Another account cannot be loaded for the ' + run + ' run without a trusted binding', unbound.status === 'invalid_seed');
      const loaded = await admin.call('env.load_seed', {expected_version: version, request_id: run + '-history', data, binding, virtual_now: historyTime});
      check('Infra loads the ' + run + ' run from history with its binding', loaded.status === 'ready');
      return {admin, client: await open('agent', run)};
    }
    const {client: delegate} = await seededRun('delegate', 'pdm-alex', 'person-alex');
    const seen = await delegate.call(T('shipments.list'), {include_closed: true});
    check('Collector sees only the authorized parcel, without tracking number or sender',
      seen.items.length === 1 && seen.items[0].id === 'S002' && seen.items[0].access === 'delegate' && seen.items[0].tracking_number === null && seen.items[0].sender_label === null);
    const delegatePass = await delegate.call(T('pass.get'), {id: 'S002'});
    check('Collector retrieves their own pass', delegatePass.pass.role === 'delegate' && delegatePass.pass.valid_now === true && delegatePass.pass.code !== 'K7QM-4R2X');
    const detail = await delegate.call(T('shipments.get'), {id: 'S002'});
    check('Collector sees pickup details but no plan, recipient or timeline', detail.shipment.plan === null && detail.shipment.recipient_person_id === null &&
      detail.shipment.timeline.length === 0 && detail.shipment.pickup.point_id === 'P01');
    check('Collector cannot preview a change', (await delegate.call(T('change.preview'), {id: 'S002', kind: 'redirect', point_id: 'P03'})).status === 'not_found');
    check('Collector cannot authorize anyone else', (await delegate.call(T('grant.create'), {id: 'S002', collector_person_id: 'person-sam', expires_at: '2026-03-04T12:00:00Z',
      confirmation: 'cf-guess', expected_version: detail.version, request_id: 'onward'})).status === 'not_found');
    check('Collector cannot revoke or see other parcels', (await delegate.call(T('grant.revoke'), {id: 'G001', expected_version: detail.version, request_id: 'self-revoke'})).status === 'not_found' &&
      (await delegate.call(T('shipments.get'), {id: 'S001'})).status === 'not_found');
    check('Caller cannot name another person or account', (await delegate.call(T('shipments.list'), {owner_person_id: 'person-maya'})).status === 'invalid_arguments' &&
      (await delegate.call(T('shipments.get'), {id: 'S001', account_id: 'pdm-maya'})).status === 'invalid_arguments');
    const {client: stranger} = await seededRun('stranger', 'pdm-sam', 'person-sam');
    check('Unauthorized person sees no parcel, pass or notice', (await stranger.call(T('shipments.list'), {include_closed: true})).items.length === 0 &&
      (await stranger.call(T('shipments.get'), {id: 'S002'})).status === 'not_found' && (await stranger.call(T('pass.get'), {id: 'S002'})).status === 'not_found' &&
      (await stranger.call(T('notices.list'))).items.length === 0);

    // ---- W4 + reset: a seed with a pending request and a live grant is restored exactly ----
    const reloaded = await infra.call('env.load_seed', {expected_version: snap.version, request_id: 'history', data: history, virtual_now: historyTime});
    check('Infra loads history containing a pending request and a live grant', reloaded.status === 'ready');
    let read = await agent.call(T('grants.list'), {shipment_id: 'S002'});
    check('Loaded grant is live', read.items.length === 1 && read.items[0].valid_now === true);
    const revoked = await agent.call(T('grant.revoke'), {id: 'G001', expected_version: read.version, request_id: 'w3-revoke'});
    check('Recipient revokes the authorization', revoked.status === 'committed' && revoked.grant_status === 'revoked');
    const cancelled = await agent.call(T('change.cancel'), {id: pendingChange.change_id, expected_version: revoked.version, request_id: 'w3-cancel'});
    check('Recipient withdraws the pending request', cancelled.status === 'committed');
    snap = await infra.call('env.snapshot');
    const lateApproval = await infra.call('env.apply_event', {expected_version: snap.version,
      event: event('change_resolved', '2026-03-02T16:00:00Z', {shipment_id: 'S001', change_id: pendingChange.change_id, base_plan_revision: 1, decision: 'applied', reason: null})});
    const afterLate = (await infra.call('env.snapshot')).snapshot.data.shipments.find(x => x.id === 'S001').plan;
    check('Cancel first: a later carrier approval cannot apply', lateApproval.status === 'invalid_event' && afterLate.revision === 1 && afterLate.mode === 'home');
    const tooEarly = await infra.call('env.apply_event', {expected_version: snap.version, event: event('deadline_reached', '2026-03-04T14:59:59Z', {shipment_id: 'S002', deadline: 'pickup'})});
    check('Deadline event before the deadline is rejected', tooEarly.status === 'invalid_event');
    const expiry = await infra.call('env.apply_event', {expected_version: snap.version, event: event('deadline_reached', '2026-03-04T15:00:00Z', {shipment_id: 'S002', deadline: 'pickup'})});
    check('Pickup expiry starts the return', expiry.status === 'committed');
    read = await agent.call(T('change.preview'), {id: 'S002', kind: 'home_delivery', address_id: 'addr-maya-home'});
    check('Returning parcel refuses changes', read.preview.allowed === false && read.preview.reason === 'return_started');
    const forced = await agent.call(T('change.submit'), {id: 'S002', kind: 'home_delivery', address_id: 'addr-maya-home', confirmation: 'cf-guess', expected_version: read.version, request_id: 'w4-forced'});
    check('Submitting a change on a returning parcel fails with return_started', forced.status === 'return_started');
    const lateCollect = await infra.call('env.apply_event', {expected_version: read.version,
      event: event('collected', '2026-03-04T15:30:00Z', {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: 'K7QM-4R2X'})});
    check('Returning parcel cannot be collected', lateCollect.status === 'invalid_event');
    const returned = await infra.call('env.apply_event', {expected_version: read.version, event: event('return_completed', '2026-03-06T15:00:00Z', {shipment_id: 'S002'})});
    check('Only the trusted completion event finishes the return', returned.status === 'committed' &&
      (await agent.call(T('shipments.get'), {id: 'S002'})).shipment.status === 'returned');
    snap = await infra.call('env.snapshot');
    check('Reset after these changes returns ready', (await infra.call('env.reset', {expected_version: snap.version})).status === 'ready');
    snap = await infra.call('env.snapshot');
    check('Reset restores the loaded history exactly', JSON.stringify(snap.snapshot.data) === JSON.stringify(history) && Date.parse(snap.snapshot.virtual_now) === Date.parse(historyTime));
    read = await agent.call(T('grants.list'), {shipment_id: 'S002'});
    check('Grant and pending request are live again after reset', read.items[0].status === 'active' && read.items[0].valid_now === true &&
      (await agent.call(T('shipments.get'), {id: 'S001'})).shipment.pending_change.status === 'pending');

    // ---- Two different collectors race for one parcel on one ledger ----
    const alexCode = history.passes.find(p => p.holder_person_id === 'person-alex').code;
    const handoff = (at, collector_person_id, pass_code) => event('collected', at, {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id, pass_code});
    const second = await open('infra', 'main');
    const [a, b] = await Promise.all([
      infra.call('env.apply_event', {expected_version: snap.version, event: handoff('2026-03-03T15:00:00Z', 'person-maya', 'K7QM-4R2X')}),
      second.call('env.apply_event', {expected_version: snap.version, event: handoff('2026-03-03T15:00:00Z', 'person-alex', alexCode)})
    ]);
    const outcomes = [a.status, b.status].sort();
    check('Exactly one of two concurrent collectors commits', outcomes[0] === 'committed' && outcomes[1] === 'stale_version');
    snap = await infra.call('env.snapshot');
    const loser = a.status === 'committed' ? handoff('2026-03-03T15:05:00Z', 'person-alex', alexCode) : handoff('2026-03-03T15:05:00Z', 'person-maya', 'K7QM-4R2X');
    check('The other collector is rejected even with a fresh version', (await infra.call('env.apply_event', {expected_version: snap.version, event: loser})).status === 'invalid_event');
    snap = await infra.call('env.snapshot');
    const passStates = snap.snapshot.data.passes.map(p => p.status).sort();
    check('Parcel was handed over once: one pass consumed, the other invalidated', snap.snapshot.data.shipments.find(s => s.id === 'S002').status === 'collected' &&
      JSON.stringify(passStates) === JSON.stringify(['consumed', 'invalidated']));
    check('Collected parcel has no pass', (await agent.call(T('pass.get'), {id: 'S002'})).status === 'not_available');

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

    // ---- Arrival sets the deadline once; collection exactly at the deadline fails ----
    const apply = async e => infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event: e});
    check('Carrier applies the redirect', (await apply(event('change_resolved', '2026-03-03T15:10:00Z',
      {shipment_id: 'S003', change_id: inside.change_id, base_plan_revision: 1, decision: 'applied', reason: null}))).status === 'committed');
    const arrival = (at, pickup_epoch) => event('pickup_ready', at, {shipment_id: 'S003', plan_revision: 2, point_id: 'P03', pickup_epoch});
    check('Arrival makes the parcel ready', (await apply(arrival('2026-03-03T16:00:00Z', 1))).status === 'committed');
    const readyParcel = async () => (await infra.call('env.snapshot')).snapshot.data.shipments.find(x => x.id === 'S003');
    const firstDeadline = (await readyParcel()).pickup.deadline;
    check('Deadline is the arrival time plus the policy window', firstDeadline === '2026-03-05T16:00:00.000Z');
    const repeats = [await apply(arrival('2026-03-04T16:00:00Z', 1)), await apply(arrival('2026-03-04T16:00:00Z', 2))];
    check('A repeated arrival, with either epoch, is rejected', repeats.every(r => r.status === 'invalid_event'));
    check('The pickup deadline was not extended', (await readyParcel()).pickup.deadline === firstDeadline && (await readyParcel()).pickup.epoch === 1);
    const ownPass = (await infra.call('env.snapshot')).snapshot.data.passes.find(p => p.shipment_id === 'S003' && p.status === 'active');
    const take = at => event('collected', at, {shipment_id: 'S003', point_id: 'P03', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: ownPass.code});
    const atDeadline = await apply(take('2026-03-05T16:00:00Z')); // Thursday 11:00 local: the point is open, only the deadline blocks it
    check('Collection exactly at the deadline fails', atDeadline.status === 'invalid_event' && /deadline/.test(atDeadline.message) && (await readyParcel()).status === 'at_pickup');
    check('Collection one second before the deadline succeeds', (await apply(take('2026-03-05T15:59:59Z'))).status === 'committed' && (await readyParcel()).status === 'collected');

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
