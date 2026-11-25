'use strict';
// Real-MCP integration checks against the public runtime (Core over stdio),
// using this package's own registry and separate Agent and Infra connections.
// Unlike tests/business.test.cjs this needs the shared runtime: run it inside
// the public checkout, or set PALE_RUNTIME_ROOT to its runtime/ directory.
//
//   node --test tests/runtime.integration.cjs
//
// Every invocation starts from fresh run state: a temporary directory that is
// removed afterwards or, when UCR_STATE_DIR is set, a new subdirectory of it
// that is kept for inspection. When UCR_EVIDENCE_DIR is set, snapshots are
// exported there before each reset, because reset and seed replacement clear
// Core's audit and receipts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pkg = path.resolve(__dirname, '..');
const APP = require('../app.json').app_id;
function runtimeRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  for (let dir = pkg; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) return path.join(dir, 'runtime');
    if (path.dirname(dir) === dir) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
  }
}
const runtime = runtimeRoot();
const {Client} = require(path.join(runtime, 'client.cjs'));
const registry = path.join(pkg, 'registry.local.json');
const keepState = Boolean(process.env.UCR_STATE_DIR);
const stateParent = keepState ? path.resolve(process.env.UCR_STATE_DIR) : os.tmpdir();
fs.mkdirSync(stateParent, {recursive: true});
const stateDir = fs.mkdtempSync(path.join(stateParent, keepState ? 'run-' : 'ucr-runtime-'));
const evidenceDir = process.env.UCR_EVIDENCE_DIR ? path.resolve(process.env.UCR_EVIDENCE_DIR) : null;
const tool = name => APP + '.' + name;
const HIST = {section_ids: ['sec-hist105-lec1']};

const clients = [];
async function connect(role, run, profile) {
  const client = new Client(APP, role, run, stateDir, 'ucr-integration', {registry, ...(profile ? {initialProfile: profile} : {})});
  clients.push(client);
  await client.initialize();
  return client;
}
async function snapshot(infra) { return infra.call('env.snapshot'); }
function keep(name, value) {
  if (!evidenceDir) return;
  fs.mkdirSync(evidenceDir, {recursive: true});
  fs.writeFileSync(path.join(evidenceDir, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}
const versions = {
  runtime: require(path.join(runtime, 'package.json')).version,
  app: require('../app.json').version,
  core_api: require('../app.json').core_api_version,
  node: process.version
};

test.after(async () => {
  await Promise.allSettled(clients.map(c => c.close()));
  if (!keepState) fs.rmSync(stateDir, {recursive: true, force: true});
});

test('Agent and Infra see different operations; the Agent cannot reach management', async () => {
  const infra = await connect('infra', 'authority', 'sandbox'), agent = await connect('agent', 'authority');
  const agentTools = (await agent.request('tools/list')).result.tools.map(t => t.name);
  assert.deepEqual(agentTools, require('../tools.json').map(t => t.name));
  const infraTools = (await infra.request('tools/list')).result.tools.map(t => t.name);
  assert.ok(infraTools.every(name => name.startsWith('env.')) && infraTools.includes('env.advance_time'));
  for (const name of infraTools) assert.equal((await agent.call(name, {})).status, 'permission_denied', name);
  assert.equal((await agent.call(tool('catalog.search'), {role: 'infra', run_id: 'other'})).status, 'invalid_arguments');
});

test('one read and one write through MCP: committed state, receipt, retry and version rules', async () => {
  const infra = await connect('infra', 'workflow', 'sandbox'), agent = await connect('agent', 'workflow');
  const initial = await snapshot(infra);

  const read = await agent.call(tool('catalog.search'), {department: 'History'});
  assert.equal(read.status, 'ok');
  assert.deepEqual(read.version, initial.version, 'a read reports the version it observed');
  const available = read.courses[0].sections[0].available;
  assert.deepEqual((await snapshot(infra)).snapshot.data, initial.snapshot.data, 'a read does not change business data');

  const args = {...HIST, expected_version: read.version, request_id: 'it-enroll-1'};
  const response = await agent.request('tools/call', {name: tool('enrollment.enroll'), arguments: args});
  const committed = response.result.structuredContent;
  assert.equal(response.result.isError, false);
  assert.equal(committed.status, 'committed');
  assert.deepEqual(committed.version, {epoch: read.version.epoch, revision: read.version.revision + 1});
  const after = await snapshot(infra), data = after.snapshot.data;
  assert.deepEqual(after.version, committed.version);
  assert.deepEqual(data.enrollments.at(-1), {id: committed.id, seq: 6, occupant_ref: 'stu-noor', course_id: 'crs-hist105',
    section_ids: HIST.section_ids, status: 'enrolled', enrolled_at: after.snapshot.virtual_now, ended_at: null});
  assert.equal(data.receipts.at(-1).id, committed.receipt_id);
  assert.equal(data.receipts.at(-1).request_id, 'it-enroll-1');
  assert.equal((await agent.call(tool('catalog.search'), {department: 'History'})).courses[0].sections[0].available, available - 1);

  // Identical retry, even with the now-old version: the original result, once.
  const retry = await agent.call(tool('enrollment.enroll'), args);
  assert.equal(retry.duplicate, true);
  assert.deepEqual({...retry, duplicate: undefined}, {...committed, duplicate: undefined});
  // Same request ID, different content.
  const reused = await agent.call(tool('enrollment.enroll'), {...args, section_ids: ['sec-cs310-lec1']});
  assert.equal(reused.status, 'idempotency_conflict');
  // A stale observation is refused and reports where the App is now.
  const stale = await agent.call(tool('enrollment.enroll'), {...HIST, expected_version: read.version, request_id: 'it-enroll-2'});
  assert.equal(stale.status, 'stale_version');
  assert.deepEqual(stale.current_version, committed.version);
  // A rule failure is an error result with the App's status, and nothing is applied.
  const refused = await agent.request('tools/call', {name: tool('enrollment.enroll'),
    arguments: {section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1'], expected_version: committed.version, request_id: 'it-enroll-3'}});
  assert.equal(refused.result.isError, true);
  assert.equal(refused.result.structuredContent.status, 'section_full');
  assert.equal(refused.result.structuredContent.applied, false);
  const settled = await snapshot(infra);
  assert.deepEqual(settled.snapshot.data, data, 'retry, conflict, stale and refused calls changed no business data');
  assert.deepEqual(settled.version, committed.version);
  assert.equal(settled.snapshot.data.enrollments.filter(e => e.course_id === 'crs-hist105').length, 1);
  const audit = settled.snapshot.audit.filter(row => row.tool === tool('enrollment.enroll'));
  assert.deepEqual(audit.map(row => row.decision + ':' + (row.reason || 'committed')),
    ['allow:committed', 'deny:idempotency_conflict', 'deny:stale_version', 'deny:section_full']);

  // Advancing the clock invalidates earlier observations.
  const advanced = await infra.call('env.advance_time', {request_id: 'it-clock-1', expected_version: settled.version, virtual_now: '2027-01-11T12:00:00-05:00'});
  assert.equal(advanced.advanced, true);
  const late = await agent.call(tool('enrollment.enroll'), {section_ids: ['sec-cs310-lec1'], expected_version: committed.version, request_id: 'it-enroll-4'});
  assert.equal(late.status, 'stale_version');

  keep('workflow-before-reset', {versions, snapshot: (await snapshot(infra)).snapshot});
  const current = await snapshot(infra);
  assert.equal((await infra.call('env.reset', {expected_version: current.version})).status, 'ready');
  const restored = await snapshot(infra);
  assert.deepEqual(restored.snapshot.data, initial.snapshot.data, 'reset returns to the loaded baseline');
  assert.equal(restored.snapshot.virtual_now, initial.snapshot.virtual_now);
  assert.ok(restored.version.epoch > current.version.epoch);
});

test('the scenario profile is read-only, and separate runs do not share state', async () => {
  const infra = await connect('infra', 'restricted'), agent = await connect('agent', 'restricted');
  const start = await snapshot(infra);
  assert.equal(start.snapshot.profile, 'scenario');
  assert.equal((await agent.call(tool('catalog.search'), {})).status, 'ok');
  const denied = await agent.call(tool('enrollment.enroll'), {...HIST, expected_version: start.version, request_id: 'it-denied'});
  assert.equal(denied.status, 'permission_denied');
  assert.deepEqual((await snapshot(infra)).snapshot.data, start.snapshot.data);

  const other = await connect('infra', 'fresh-again');
  assert.deepEqual((await snapshot(other)).snapshot.data, start.snapshot.data, 'two fresh runs start from identical data');
  const worked = await connect('infra', 'workflow');
  assert.deepEqual((await snapshot(worked)).snapshot.data, start.snapshot.data, 'the reset run matches a fresh one');
});

test('preview, then confirm: a stale preview is refused and the original enrollment is kept', async () => {
  const infra = await connect('infra', 'preview', 'sandbox'), agent = await connect('agent', 'preview');
  const start = await snapshot(infra);
  const swapArgs = {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']};

  // Every read tool answers over MCP with output that passes its declared schema.
  for (const [name, args] of [['course.get', {id: 'crs-cs240'}], ['record.get', {}], ['schedule.get', {}], ['waitlist.list', {}], ['activity.list', {}]]) {
    const reply = await agent.request('tools/call', {name: tool(name), arguments: args});
    assert.equal(reply.result.isError, false, name);
    assert.equal(reply.result.structuredContent.status, 'ok', name);
  }
  const malformed = await agent.request('tools/call', {name: tool('change.preview'), arguments: {action: 'enroll', id: 'enr-noor-math221'}});
  assert.equal(malformed.result.isError, true);
  assert.equal(malformed.result.structuredContent.status, 'invalid_arguments');

  // A preview is a read: it reports the version it was computed from and stores nothing.
  const preview = await agent.call(tool('change.preview'), {action: 'swap', ...swapArgs});
  assert.equal(preview.allowed, true);
  assert.deepEqual(preview.version, start.version);
  assert.deepEqual((await snapshot(infra)).snapshot.data, start.snapshot.data);

  // Another commit lands between the preview and its confirmation.
  const other = await agent.call(tool('enrollment.enroll'), {...HIST, expected_version: preview.version, request_id: 'pv-enroll'});
  assert.equal(other.status, 'committed');
  const stale = await agent.call(tool('enrollment.swap'), {...swapArgs, expected_version: preview.version, request_id: 'pv-swap-1'});
  assert.equal(stale.status, 'stale_version');
  let data = (await snapshot(infra)).snapshot.data;
  assert.equal(data.enrollments.find(e => e.id === 'enr-noor-math221').status, 'enrolled', 'the original place is kept');

  // A strictly later clock advance also invalidates a preview.
  const second = await agent.call(tool('change.preview'), {action: 'swap', ...swapArgs});
  assert.deepEqual(second.version, other.version);
  const tick = await infra.call('env.advance_time', {request_id: 'pv-clock', expected_version: second.version, virtual_now: '2027-01-11T10:00:00-05:00'});
  assert.equal(tick.advanced, true);
  assert.equal((await agent.call(tool('enrollment.swap'), {...swapArgs, expected_version: second.version, request_id: 'pv-swap-2'})).status, 'stale_version');

  // A fresh preview, then the confirmation with its version, commits both halves together.
  const third = await agent.call(tool('change.preview'), {action: 'swap', ...swapArgs});
  assert.deepEqual([third.allowed, third.version], [true, tick.version]);
  const swapped = await agent.call(tool('enrollment.swap'), {...swapArgs, expected_version: third.version, request_id: 'pv-swap-3'});
  assert.equal(swapped.status, 'committed');
  assert.equal(swapped.credits.enrolled, third.credits.resulting);
  data = (await snapshot(infra)).snapshot.data;
  assert.equal(data.enrollments.find(e => e.id === 'enr-noor-math221').status, 'swapped_out');
  assert.deepEqual(data.enrollments.find(e => e.id === swapped.id).section_ids, ['sec-math221-lec2']);
  assert.equal(data.enrollments.find(e => e.id === swapped.id).enrolled_at, '2027-01-11T10:00:00-05:00', 'business time is the virtual clock');
  assert.equal((await agent.call(tool('enrollment.swap'), {...swapArgs, expected_version: third.version, request_id: 'pv-swap-3'})).duplicate, true);

  // Another occupant's enrollment cannot be withdrawn: for this account it does not exist.
  const foreign = await agent.request('tools/call', {name: tool('enrollment.withdraw'),
    arguments: {id: 'enr-synthetic-017-cs240', expected_version: swapped.version, request_id: 'pv-foreign'}});
  assert.equal(foreign.result.isError, true);
  assert.equal(foreign.result.structuredContent.status, 'not_found');
  const withdrawn = await agent.call(tool('enrollment.withdraw'), {id: 'enr-noor-stat210', expected_version: swapped.version, request_id: 'pv-withdraw'});
  assert.equal(withdrawn.status, 'committed');
  const end = await snapshot(infra);
  assert.equal(end.snapshot.data.enrollments.find(e => e.id === 'enr-synthetic-017-cs240').status, 'enrolled');
  assert.deepEqual(end.snapshot.data.receipts.map(r => r.action), ['enrollment.enroll', 'enrollment.swap', 'enrollment.withdraw']);
  assert.deepEqual((await agent.call(tool('activity.list'), {})).receipts, end.snapshot.data.receipts);
  keep('preview-confirm-before-reset', {versions, snapshot: end.snapshot});
});

test('live data reloads as a seed without a bundle; reset then returns to that checkpoint', async () => {
  const infra = await connect('infra', 'checkpoint', 'sandbox'), agent = await connect('agent', 'checkpoint');
  const original = await snapshot(infra);
  const read = await agent.call(tool('catalog.search'), {});
  await agent.call(tool('enrollment.enroll'), {...HIST, expected_version: read.version, request_id: 'cp-enroll'});
  const live = await snapshot(infra);
  assert.equal(live.snapshot.data.enrollments.length, original.snapshot.data.enrollments.length + 1);
  keep('checkpoint-before-reload', {versions, snapshot: live.snapshot});
  const load = (from, extra) => infra.call('env.load_seed', {data: from.snapshot.data, binding: from.snapshot.binding,
    policies: from.snapshot.policies, virtual_now: from.snapshot.virtual_now, ...extra});

  // The snapshot's bundle still declares the original record count, so Core
  // refuses it for data that has grown. A checkpoint is loaded without it.
  const withBundle = await load(live, {expected_version: live.version, request_id: 'cp-with-bundle', bundle: live.snapshot.resources.bundle});
  assert.equal(withBundle.status, 'invalid_bundle');
  assert.deepEqual((await snapshot(infra)).version, live.version, 'the refused load changed nothing');

  const loaded = await load(live, {expected_version: live.version, request_id: 'cp-load'});
  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.loaded, require('../plugin.cjs').objects(live.snapshot.data).length);
  const resumed = await snapshot(infra);
  assert.deepEqual(resumed.snapshot.data, live.snapshot.data, 'business records are preserved');
  assert.equal(resumed.snapshot.virtual_now, live.snapshot.virtual_now);
  assert.equal(resumed.snapshot.profile, live.snapshot.profile, 'loading a seed does not select another profile');
  assert.deepEqual(resumed.version, {epoch: live.version.epoch + 1, revision: 0}, 'a new epoch starts');
  assert.ok(!Object.keys(resumed.snapshot.receipts).some(key => key.startsWith('request:')), 'earlier request results are not carried over');
  assert.equal((await load(live, {expected_version: live.version, request_id: 'cp-load'})).duplicate, true, 'an identical load retry is not applied twice');

  // An observation from the old epoch is refused; a fresh read continues.
  const old = await agent.call(tool('enrollment.enroll'), {section_ids: ['sec-cs310-lec1'], expected_version: live.version, request_id: 'cp-old-epoch'});
  assert.equal(old.status, 'stale_version');
  assert.deepEqual((await agent.call(tool('catalog.search'), {})).version, resumed.version);

  // Reset now returns to the checkpoint; the original seed has to be loaded again to go back further.
  assert.equal((await infra.call('env.reset', {expected_version: resumed.version})).status, 'ready');
  const afterReset = await snapshot(infra);
  assert.deepEqual(afterReset.snapshot.data, live.snapshot.data, 'reset restores the checkpoint');
  assert.equal((await load(original, {expected_version: afterReset.version, request_id: 'cp-original'})).status, 'ready');
  assert.deepEqual((await snapshot(infra)).snapshot.data, original.snapshot.data, 'reloading the original seed restores the initial state');
});

test('the declared entrypoint service.cjs starts the same App', async () => {
  const launch = async role => {
    const client = new Client(APP, role, 'launcher', stateDir, 'ucr-integration', {service: path.join(pkg, 'service.cjs')});
    clients.push(client);
    await client.initialize();
    return client;
  };
  const infra = await launch('infra'), agent = await launch('agent');
  const start = await snapshot(infra);
  assert.deepEqual(start.snapshot.data, require('../fixtures/minimal.json'));
  assert.equal(start.snapshot.virtual_now, require('../fixtures/clock.json').initial_time);
  const listed = (await agent.request('tools/list')).result.tools.map(t => t.name);
  assert.deepEqual(listed, require('../fixtures/policies.json').scenario.allow, 'a new instance starts with the scenario profile');
  assert.equal((await agent.call(tool('catalog.search'), {})).status, 'ok');
});

// ---- waitlists, offers and Infra events over real MCP -------------------------------
const EVENT = (event_id, at, operation, payload = {}) => ({event_id, at, operation: tool(operation), payload});
const EVT_0007 = require('../examples/scenario.json');
const DEADLINE = '2027-01-12T09:30:00-05:00';
const apply = async (infra, event, extra = {}) => infra.call('env.apply_event', {event, expected_version: (await snapshot(infra)).version, ...extra});

test('an Infra event frees a seat, the Agent is offered it and accepts; event retries apply nothing twice', async () => {
  const infra = await connect('infra', 'offers', 'sandbox'), agent = await connect('agent', 'offers');
  const start = await snapshot(infra);
  assert.deepEqual(start.snapshot.data.offers, []);
  // The Agent cannot inject events.
  assert.equal((await agent.call('env.apply_event', {event: EVT_0007, expected_version: start.version})).status, 'permission_denied');

  const applied = await infra.call('env.apply_event', {event: EVT_0007, expected_version: start.version});
  assert.equal(applied.status, 'committed');
  assert.deepEqual(applied.version, {epoch: start.version.epoch, revision: start.version.revision + 1});
  const offered = await snapshot(infra);
  assert.equal(offered.snapshot.virtual_now, EVT_0007.at, 'the event moved the App clock to its own time');
  assert.deepEqual(offered.snapshot.data.offers.map(o => [o.id, o.entry_id, o.status, o.issued_at, o.expires_at]),
    [['off-6', 'wl-noor-cs240', 'live', EVT_0007.at, DEADLINE]]);
  // The identical event again, even with the old version: Core's original receipt, no second offer or notice.
  const again = await infra.call('env.apply_event', {event: EVT_0007, expected_version: start.version});
  assert.equal(again.duplicate, true);
  assert.equal((await infra.call('env.apply_event', {event: {...EVT_0007, payload: {...EVT_0007.payload, occupant_ref: 'synthetic-018'}},
    expected_version: offered.version})).status, 'idempotency_conflict');
  const receipt = (await infra.call('env.event_status', {event_id: EVT_0007.event_id})).receipt;
  assert.deepEqual([receipt.status, receipt.event_id, receipt.version], ['committed', 'evt-0007', applied.version]);
  assert.deepEqual((await snapshot(infra)).snapshot.data, offered.snapshot.data);
  assert.equal(offered.snapshot.data.notices.length, 1);
  // An event the App refuses is an error with the App's status; the clock does not move.
  const refused = await infra.call('env.apply_event', {event: EVENT('it-full', '2027-01-11T10:00:00-05:00', 'occupancy.change',
    {change: 'enroll', occupant_ref: 'synthetic-070', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1']}), expected_version: offered.version});
  assert.equal(refused.status, 'section_full');
  assert.deepEqual([(await snapshot(infra)).snapshot.virtual_now, (await snapshot(infra)).version], [EVT_0007.at, offered.version]);

  // The Agent sees the offer and the notice, previews the acceptance and confirms it.
  const list = await agent.call(tool('waitlist.list'), {});
  assert.deepEqual(list.offers.map(o => [o.id, o.expires_at, o.expired]), [['off-6', DEADLINE, false]]);
  assert.deepEqual((await agent.call(tool('activity.list'), {})).notices.map(n => [n.kind, n.refs.event_id]), [['offer_issued', 'evt-0007']]);
  const preview = await agent.call(tool('change.preview'), {action: 'accept_offer', id: 'off-6'});
  assert.deepEqual([preview.allowed, preview.credits.resulting, preview.version], [true, 10, offered.version]);
  const reply = await agent.request('tools/call', {name: tool('offer.accept'), arguments: {id: 'off-6', expected_version: preview.version, request_id: 'of-accept'}});
  assert.equal(reply.result.isError, false);
  const accepted = reply.result.structuredContent;
  assert.deepEqual([accepted.status, accepted.offer_id, accepted.replaced_id, accepted.credits.enrolled], ['committed', 'off-6', null, 10]);
  const end = await snapshot(infra), data = end.snapshot.data;
  assert.deepEqual(data.enrollments.at(-1), {id: accepted.id, seq: data.enrollments.at(-1).seq, occupant_ref: 'stu-noor', course_id: 'crs-cs240',
    section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1'], status: 'enrolled', enrolled_at: EVT_0007.at, ended_at: null});
  assert.deepEqual([data.offers[0].status, data.waitlist_entries[0].status, data.receipts.at(-1).id], ['accepted', 'fulfilled', accepted.receipt_id]);
  // The audit names the object each call acted on.
  const audit = end.snapshot.audit.filter(row => row.tool === tool('offer.accept'));
  assert.deepEqual(audit.map(row => [row.decision, row.result.object_id]), [['allow', accepted.id]]);
  assert.equal((await agent.call(tool('offer.accept'), {id: 'off-6', expected_version: end.version, request_id: 'of-accept-2'})).status, 'offer_not_live');

  // A waitlist of her own: join, rejoin, leave.
  const joined = await agent.call(tool('waitlist.join'), {section_ids: ['sec-psyc100-lec1'], expected_version: end.version, request_id: 'of-join'});
  assert.deepEqual([joined.status, joined.existing, joined.rank], ['committed', false, 1]);
  const rejoined = await agent.call(tool('waitlist.join'), {section_ids: ['sec-psyc100-lec1'], expected_version: joined.version, request_id: 'of-join-2'});
  assert.deepEqual([rejoined.id, rejoined.existing, rejoined.rank], [joined.id, true, 1]);
  const free = await agent.call(tool('waitlist.join'), {section_ids: HIST.section_ids, expected_version: rejoined.version, request_id: 'of-join-3'});
  assert.equal(free.status, 'seats_available');
  const left = await agent.call(tool('waitlist.leave'), {id: joined.id, expected_version: rejoined.version, request_id: 'of-leave'});
  assert.equal(left.status, 'committed');
  assert.deepEqual((await agent.call(tool('waitlist.list'), {})).entries, []);
  keep('offers-before-reset', {versions, snapshot: (await snapshot(infra)).snapshot});
});

test('the Agent and an Infra event race for the last seat: exactly one gets it', async () => {
  const infra = await connect('infra', 'race', 'sandbox'), agent = await connect('agent', 'race');
  // One seat left in HIST105.
  const base = await snapshot(infra), seed = structuredClone(base.snapshot.data);
  const hist = seed.sections.find(s => s.id === 'sec-hist105-lec1');
  hist.base_enrolled = hist.capacity - 1;
  const loaded = await infra.call('env.load_seed', {data: seed, binding: base.snapshot.binding, policies: base.snapshot.policies,
    virtual_now: base.snapshot.virtual_now, expected_version: base.version, request_id: 'race-load'});
  assert.equal(loaded.status, 'ready');
  const rival = n => EVENT('race-' + n, base.snapshot.virtual_now, 'occupancy.change', {change: 'enroll', occupant_ref: 'synthetic-08' + n, section_ids: HIST.section_ids});
  const seat = async () => (await agent.call(tool('catalog.search'), {department: 'History'})).courses[0].sections[0];
  const holders = async () => (await snapshot(infra)).snapshot.data.enrollments.filter(e => e.course_id === 'crs-hist105' && e.status === 'enrolled').map(e => e.occupant_ref);

  // Both act on the same observed version at the same moment.
  const seen = (await snapshot(infra)).version;
  assert.equal((await seat()).available, 1);
  const [mine, theirs] = await Promise.all([
    agent.call(tool('enrollment.enroll'), {...HIST, expected_version: seen, request_id: 'race-agent'}),
    infra.call('env.apply_event', {event: rival(1), expected_version: seen})
  ]);
  assert.deepEqual([mine.status, theirs.status].sort(), ['committed', 'stale_version'], 'one commit, one stale observation');
  assert.equal((await holders()).length, 1);
  assert.deepEqual([(await seat()).available, (await seat()).enrolled], [0, hist.capacity], 'the section is exactly full, not over');

  // The loser looks again and tries once more: the seat is gone, and nothing changes.
  const now = (await snapshot(infra)).version, before = (await snapshot(infra)).snapshot.data;
  const second = mine.status === 'committed'
    ? await infra.call('env.apply_event', {event: rival(2), expected_version: now})
    : await agent.call(tool('enrollment.enroll'), {...HIST, expected_version: now, request_id: 'race-agent-2'});
  assert.equal(second.status, 'section_full');
  assert.deepEqual((await snapshot(infra)).snapshot.data, before);
  assert.equal((await holders()).length, 1);
  keep('race-before-reset', {versions, winner: mine.status === 'committed' ? 'agent' : 'infra event', snapshot: (await snapshot(infra)).snapshot});
});

test('the clock reaches an offer deadline before the expiry event: accepting and declining fail, reads change nothing, the hold stays', async () => {
  const infra = await connect('infra', 'expiry', 'sandbox'), agent = await connect('agent', 'expiry');
  assert.equal((await apply(infra, EVT_0007)).status, 'committed');
  const offered = await snapshot(infra);
  // Infra advances the clock to the deadline without processing the due expiry. The App has no scheduler: nothing runs.
  const tick = await infra.call('env.advance_time', {request_id: 'ex-clock', expected_version: offered.version, virtual_now: DEADLINE});
  assert.equal(tick.advanced, true);
  const atDeadline = await snapshot(infra);
  assert.deepEqual(atDeadline.snapshot.data, offered.snapshot.data, 'advancing time alone changes no business record');

  const list = await agent.call(tool('waitlist.list'), {});
  assert.deepEqual(list.offers.map(o => [o.id, o.expired]), [['off-6', true]], 'the read reports the offer as expired');
  const preview = await agent.call(tool('change.preview'), {action: 'accept_offer', id: 'off-6'});
  assert.deepEqual(preview.failures.map(f => f.code), ['offer_expired']);
  // An acceptance prepared before the advance is stale; a fresh one is refused by the App's own guard.
  assert.equal((await agent.call(tool('offer.accept'), {id: 'off-6', expected_version: offered.version, request_id: 'ex-accept-1'})).status, 'stale_version');
  const late = await agent.request('tools/call', {name: tool('offer.accept'), arguments: {id: 'off-6', expected_version: list.version, request_id: 'ex-accept-2'}});
  assert.equal(late.result.isError, true);
  assert.equal(late.result.structuredContent.status, 'offer_expired');
  // Declining answers the offer too, so it has the same deadline.
  const declined = await agent.request('tools/call', {name: tool('offer.decline'), arguments: {id: 'off-6', expected_version: list.version, request_id: 'ex-decline-1'}});
  assert.equal(declined.result.isError, true);
  assert.deepEqual([declined.result.structuredContent.status, declined.result.structuredContent.applied], ['offer_expired', false]);
  assert.match(declined.result.structuredContent.message, /can no longer be declined/);
  const still = await snapshot(infra);
  assert.deepEqual(still.snapshot.data, offered.snapshot.data, 'reads and the refused answers left the ledger untouched');
  assert.deepEqual(still.version, atDeadline.version, 'and the version did not move');
  const lab = (await agent.call(tool('course.get'), {id: 'crs-cs240'})).course.sections.find(s => s.id === 'sec-cs240-lab1');
  assert.deepEqual([lab.held, lab.available], [1, 0], 'the seat stays held until the expiry is processed');

  // Infra then applies the due expiry at the deadline: hold released, next entry offered, the student told.
  const expired = await apply(infra, EVENT('evt-0015', DEADLINE, 'offers.expire'));
  assert.equal(expired.status, 'committed');
  const end = await snapshot(infra);
  assert.deepEqual(end.snapshot.data.offers.map(o => [o.entry_id, o.status]), [['wl-noor-cs240', 'expired'], ['wl-synthetic-021-cs240', 'live']]);
  assert.equal((await agent.call(tool('offer.accept'), {id: 'off-6', expected_version: end.version, request_id: 'ex-accept-3'})).status, 'offer_not_live');
  assert.equal((await agent.call(tool('offer.decline'), {id: 'off-6', expected_version: end.version, request_id: 'ex-decline-2'})).status, 'offer_not_live');
  assert.deepEqual((await agent.call(tool('activity.list'), {})).notices.map(n => [n.kind, n.refs.event_id]),
    [['offer_issued', 'evt-0007'], ['offer_expired', 'evt-0015']]);
  assert.deepEqual((await agent.call(tool('schedule.get'), {})).credits, {enrolled: 6, limit: 16});
  keep('expiry-before-reset', {versions, snapshot: end.snapshot});
});

test('a seed loaded with a clock behind its own records can be read and refuses every change until the clock catches up', async () => {
  const infra = await connect('infra', 'behind', 'sandbox'), agent = await connect('agent', 'behind');
  const base = await snapshot(infra), LATEST = '2027-01-07T09:40:00-05:00', EARLY = '2027-01-07T09:00:00-05:00';
  // The load itself is accepted: the App does not refuse a seed for the clock it is given.
  const loaded = await infra.call('env.load_seed', {data: base.snapshot.data, binding: base.snapshot.binding, policies: base.snapshot.policies,
    virtual_now: EARLY, expected_version: base.version, request_id: 'cb-load'});
  assert.equal(loaded.status, 'ready');
  const start = await snapshot(infra);
  assert.equal(start.snapshot.virtual_now, EARLY);

  // Reads answer, and a preview gives the one reason nothing can be done.
  for (const name of ['catalog.search', 'record.get', 'schedule.get', 'waitlist.list', 'activity.list']) assert.equal((await agent.call(tool(name), {})).status, 'ok', name);
  const preview = await agent.call(tool('change.preview'), {action: 'enroll', ...HIST});
  assert.deepEqual([preview.allowed, preview.failures.map(f => f.code)], [false, ['invalid_state']]);
  assert.ok(preview.failures[0].message.includes(LATEST), 'the message names the instant the clock has to reach');
  // A write is an error result with the App's status; an event dated before the record is refused as well.
  const refused = await agent.request('tools/call', {name: tool('enrollment.enroll'), arguments: {...HIST, expected_version: start.version, request_id: 'cb-enroll-1'}});
  assert.equal(refused.result.isError, true);
  assert.deepEqual([refused.result.structuredContent.status, refused.result.structuredContent.applied], ['invalid_state', false]);
  assert.equal((await agent.call(tool('waitlist.leave'), {id: 'wl-noor-cs240', expected_version: start.version, request_id: 'cb-leave'})).status, 'invalid_state');
  const early = await infra.call('env.apply_event', {event: EVENT('cb-early', '2027-01-07T09:30:00-05:00', 'offers.expire'), expected_version: start.version});
  assert.equal(early.status, 'invalid_event');
  const still = await snapshot(infra);
  assert.deepEqual([still.snapshot.data, still.snapshot.virtual_now, still.version], [start.snapshot.data, EARLY, start.version], 'neither the ledger nor the clock moved');

  // Infra brings the clock to the latest record: the same write commits, dated at that instant.
  const tick = await infra.call('env.advance_time', {request_id: 'cb-clock', expected_version: still.version, virtual_now: LATEST});
  assert.equal(tick.advanced, true);
  assert.equal((await agent.call(tool('change.preview'), {action: 'enroll', ...HIST})).allowed, true);
  const done = await agent.call(tool('enrollment.enroll'), {...HIST, expected_version: tick.version, request_id: 'cb-enroll-2'});
  assert.equal(done.status, 'committed');
  const end = await snapshot(infra);
  assert.deepEqual([end.snapshot.data.enrollments.at(-1).id, end.snapshot.data.enrollments.at(-1).enrolled_at], [done.id, LATEST]);
  keep('clock-behind-before-reset', {versions, snapshot: end.snapshot});
});

test('refused events keep the App\'s status over MCP and change nothing; the optional swap argument accepts null', async () => {
  const infra = await connect('infra', 'contract', 'sandbox'), agent = await connect('agent', 'contract');
  const start = await snapshot(infra), at = start.snapshot.virtual_now;
  const reschedule = (id, section_id, meetings) => EVENT(id, at, 'section.reschedule', {section_id, meetings});
  const monWed = (start, end) => [{days: ['WED'], start, end}, {days: ['MON'], start, end}];
  const cases = [
    [reschedule('ct-same', 'sec-math221-lec1', monWed('10:00', '11:20')), 'invalid_event'],          // its own times, split by day
    [reschedule('ct-backwards', 'sec-math221-lec1', monWed('11:20', '10:00')), 'invalid_event'],
    [reschedule('ct-unknown', 'sec-nowhere', monWed('10:00', '11:20')), 'not_found'],
    [EVENT('ct-student', at, 'occupancy.change', {change: 'withdraw', occupant_ref: 'stu-noor', enrollment_id: 'enr-noor-math221'}), 'invalid_event'],
    [EVENT('ct-nobody', at, 'occupancy.change', {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-nobody'}), 'not_found']
  ];
  for (const [event, status] of cases) {
    const reply = await infra.call('env.apply_event', {event, expected_version: start.version});
    assert.deepEqual([reply.status, reply.applied], [status, false], event.event_id);
  }
  const after = await snapshot(infra);
  assert.deepEqual([after.snapshot.data, after.version, after.snapshot.virtual_now], [start.snapshot.data, start.version, at]);
  assert.deepEqual(after.snapshot.audit.filter(row => row.tool === 'env.apply_event').map(row => row.decision + ':' + row.reason),
    cases.map(([, status]) => 'deny:' + status));

  // A real change of times is applied, and the Agent sees the conflict it made with its cause.
  const moved = await infra.call('env.apply_event', {event: reschedule('ct-moved', 'sec-math221-lec1', [{days: ['TUE', 'THU'], start: '14:30', end: '15:50'}]),
    expected_version: start.version});
  assert.equal(moved.status, 'committed');
  assert.deepEqual((await agent.call(tool('schedule.get'), {})).conflicts, [{section_ids: ['sec-math221-lec1', 'sec-stat210-lec1'],
    caused_by: {event_id: 'ct-moved', section_id: 'sec-math221-lec1', replaced_at: at, from_version: 1, to_version: 2}}]);

  // swap_from_enrollment_id: null is an entry that is not a swap, the same as leaving it out.
  const psyc = {section_ids: ['sec-psyc100-lec1']};
  const joined = await agent.call(tool('waitlist.join'), {...psyc, swap_from_enrollment_id: null, expected_version: moved.version, request_id: 'ct-join-1'});
  assert.deepEqual([joined.status, joined.swap_from_enrollment_id, joined.existing], ['committed', null, false]);
  const again = await agent.call(tool('waitlist.join'), {...psyc, expected_version: joined.version, request_id: 'ct-join-2'});
  assert.deepEqual([again.id, again.existing], [joined.id, true]);
  const empty = await agent.call(tool('waitlist.join'), {...psyc, swap_from_enrollment_id: '', expected_version: again.version, request_id: 'ct-join-3'});
  assert.equal(empty.status, 'invalid_arguments');
  keep('event-contract-before-reset', {versions, snapshot: (await snapshot(infra)).snapshot});
});

test('an event ID is stored as Core received it, whatever characters it has', async () => {
  const infra = await connect('infra', 'eventid', 'sandbox'), agent = await connect('agent', 'eventid');
  const odd = 'evt 0007/retry#1 \u00e9';
  const start = await snapshot(infra);
  const applied = await infra.call('env.apply_event', {event: {...EVT_0007, event_id: odd}, expected_version: start.version});
  assert.equal(applied.status, 'committed');
  assert.deepEqual((await agent.call(tool('activity.list'), {})).notices.map(n => [n.kind, n.refs.event_id]), [['offer_issued', odd]]);
  const receipt = (await infra.call('env.event_status', {event_id: odd})).receipt;
  assert.deepEqual([receipt.status, receipt.event_id], ['committed', odd]);
  assert.equal((await infra.call('env.apply_event', {event: {...EVT_0007, event_id: odd}, expected_version: start.version})).duplicate, true);
  // A section change under such an ID is attributed to it.
  const moved = await apply(infra, EVENT('evt 0012 moved', '2027-01-12T08:00:00-05:00', 'section.reschedule',
    {section_id: 'sec-math221-lec1', meetings: [{days: ['TUE', 'THU'], start: '14:30', end: '15:50'}]}));
  assert.equal(moved.status, 'committed');
  assert.equal((await agent.call(tool('schedule.get'), {})).conflicts[0].caused_by.event_id, 'evt 0012 moved');
  // The ledger that quotes these IDs reloads as a seed.
  const live = await snapshot(infra);
  assert.equal((await infra.call('env.load_seed', {data: live.snapshot.data, binding: live.snapshot.binding, policies: live.snapshot.policies,
    virtual_now: live.snapshot.virtual_now, expected_version: live.version, request_id: 'eid-reload'})).status, 'ready');
  // The only bound is the envelope's 100 characters; a longer ID is refused before anything is applied.
  const reloaded = await snapshot(infra);
  const long = await infra.request('tools/call', {name: 'env.apply_event', arguments: {event: EVENT('x'.repeat(101), '2027-01-12T09:00:00-05:00', 'offers.expire'),
    expected_version: reloaded.version}});
  assert.equal(long.result.isError, true);
  assert.deepEqual([long.result.structuredContent.status, long.result.structuredContent.applied], ['invalid_arguments', false]);
  assert.deepEqual((await snapshot(infra)).snapshot.data, live.snapshot.data);
  keep('event-id-before-reset', {versions, snapshot: reloaded.snapshot});
});

test('a scenario seed loads for another account and a reset returns to it', async () => {
  const infra = await connect('infra', 'scenario', 'sandbox'), agent = await connect('agent', 'scenario');
  const index = require('../fixtures/scenarios/index.json'), entry = index.scenarios.find(s => s.id === 'swaps');
  const data = require('../fixtures/scenarios/' + entry.file), base = await snapshot(infra);
  const loaded = await infra.call('env.load_seed', {data, binding: require('../fixtures/binding.json'), policies: require('../fixtures/policies.json'),
    virtual_now: entry.virtual_now, expected_version: base.version, request_id: 'sc-load'});
  assert.deepEqual([loaded.status, loaded.loaded], ['ready', entry.records]);
  const start = await snapshot(infra);
  assert.deepEqual([start.snapshot.data.account_id, start.snapshot.virtual_now, start.snapshot.profile], ['ucr-tomas', entry.virtual_now, 'sandbox']);
  assert.equal((await agent.call(tool('record.get'), {})).student.name, 'Tomas Lindqvist');
  // The running state the seed carries: a live offer on a pending swap.
  const offer = (await agent.call(tool('waitlist.list'), {})).offers[0];
  const done = await agent.call(tool('offer.accept'), {id: offer.id, expected_version: start.version, request_id: 'sc-accept'});
  assert.deepEqual([done.status, done.replaced_id], ['committed', 'enr-tomas-phys150']);
  // IDs created after the load do not collide with the seed's.
  const ids = require('../plugin.cjs').objects((await snapshot(infra)).snapshot.data);
  assert.equal(new Set(ids).size, ids.length);
  keep('scenario-before-reset', {versions, snapshot: (await snapshot(infra)).snapshot});
  assert.equal((await infra.call('env.reset', {expected_version: (await snapshot(infra)).version})).status, 'ready');
  assert.deepEqual((await snapshot(infra)).snapshot.data, data, 'reset returns to the loaded scenario, not to the default seed');
  // A seed for an account the binding does not declare is refused.
  const foreign = await infra.call('env.load_seed', {data: {...data, account_id: 'ucr-nobody'}, binding: require('../fixtures/binding.json'),
    policies: require('../fixtures/policies.json'), virtual_now: entry.virtual_now, expected_version: (await snapshot(infra)).version, request_id: 'sc-foreign'});
  assert.notEqual(foreign.status, 'ready');
});

test('the business Web Host serves the three views on the same ledger and exposes nothing else', async () => {
  const {start} = require(path.join(runtime, 'web/server.cjs'));
  const host = await start({app: APP, registry, run: 'web', stateDir, profile: 'sandbox'});
  try {
    const post = (route, body, headers = {}) => fetch(host.url + route, {method: 'POST', headers: {Origin: host.url, 'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
    // The page and its controller are this package's own files.
    const page = await fetch(host.url + '/');
    assert.equal(page.status, 200);
    assert.equal(await page.text(), fs.readFileSync(path.join(pkg, 'gui/index.html'), 'utf8'));
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'; style-src 'self'/);
    assert.equal(await (await fetch(host.url + '/app.js')).text(), fs.readFileSync(path.join(pkg, 'gui/src/app.js'), 'utf8'));
    // No data without the per-start session.
    assert.equal((await fetch(host.url + '/api/tools')).status, 401);
    const login = await post('/session', {token: new URLSearchParams(host.accessUrl.split('#')[1]).get('access')});
    const cookie = login.headers.get('set-cookie').split(';')[0], {csrf} = await login.json();
    const headers = {Cookie: cookie, 'X-Pale-CSRF': csrf};
    const call = async (name, args) => (await post('/api/call', {name, arguments: args}, headers)).json();
    // The browser gets the Agent's tools and nothing from Infra or from the package's files.
    const tools = (await (await fetch(host.url + '/api/tools', {headers: {Cookie: cookie}})).json()).tools.map(t => t.name);
    assert.deepEqual(tools, require('../tools.json').map(t => t.name));
    for (const name of ['env.snapshot', 'env.reset', 'env.load_seed', 'env.apply_event', 'env.advance_time']) {
      assert.equal((await post('/api/call', {name, arguments: {}}, headers)).status, 403, name);
    }
    for (const route of ['/fixtures/minimal.json', '/fixtures/scenarios/offers.json', '/src/operations.cjs', '/dev/contracts.cjs', '/tools.json', '/gui/src/view.js']) {
      assert.equal((await fetch(host.url + route, {headers: {Cookie: cookie}})).status, 404, route);
    }
    // Every read the three views use answers through the browser route.
    const catalog = await call(tool('catalog.search'), {});
    assert.equal(catalog.courses.length, 8);
    for (const [name, args] of [['course.get', {id: 'crs-cs240'}], ['schedule.get', {}], ['waitlist.list', {}], ['record.get', {}]]) {
      assert.equal((await call(tool(name), args)).status, 'ok', name);
    }
    // A write made through the browser route is the same commit an MCP client sees.
    const args = {...HIST, expected_version: catalog.version, request_id: 'web-enroll'};
    const written = await call(tool('enrollment.enroll'), args);
    assert.equal(written.status, 'committed');
    assert.equal((await call(tool('enrollment.enroll'), args)).duplicate, true, 'a repeated submission is not applied twice');
    assert.equal((await call(tool('enrollment.enroll'), {section_ids: ['sec-cs310-lec1'], expected_version: catalog.version, request_id: 'web-stale'})).status,
      'stale_version', 'a form opened on an older version reports the conflict');
    const refused = await call(tool('enrollment.enroll'), {section_ids: ['sec-econ101-lec1'], expected_version: written.version, request_id: 'web-refused'});
    assert.equal(refused.status, 'time_conflict');
    const agent = await connect('agent', 'web'), infra = await connect('infra', 'web');
    const schedule = await agent.call(tool('schedule.get'), {});
    assert.deepEqual(schedule.enrollments.map(e => e.code), ['MATH221', 'STAT210', 'HIST105']);
    const stored = (await snapshot(infra)).snapshot.data;
    assert.deepEqual([stored.enrollments.at(-1).id, stored.receipts.map(r => [r.action, r.request_id])], [written.id, [['enrollment.enroll', 'web-enroll']]]);
    // An Infra event is visible to the page on its next read.
    assert.equal((await apply(infra, EVT_0007)).status, 'committed');
    assert.deepEqual((await call(tool('waitlist.list'), {})).offers.map(o => o.expires_at), [DEADLINE]);
  } finally { await host.close(); }

  // A run started with the restricted profile shows the reads and refuses writes.
  const restricted = await start({app: APP, registry, run: 'web-restricted', stateDir, profile: 'scenario'});
  try {
    const listed = (await restricted.client.request('tools/list')).result.tools.map(t => t.name);
    assert.deepEqual(listed, require('../fixtures/policies.json').scenario.allow);
    const version = (await restricted.client.call(tool('catalog.search'), {})).version;
    assert.equal((await restricted.client.call(tool('waitlist.join'), {section_ids: ['sec-psyc100-lec1'], expected_version: version, request_id: 'web-denied'})).status, 'permission_denied');
  } finally { await restricted.close(); }
});
