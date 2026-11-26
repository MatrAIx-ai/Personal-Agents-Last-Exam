'use strict';
// Real public-runtime checks: MCP discovery, Core versions and receipts, history loading, events, the clock,
// reset and the evaluator-only boundary. Needs the public PALE checkout (or PALE_RUNTIME_ROOT). From its root:
//   node --test apps/milepost/tests/runtime.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

function runtimeRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  for (let dir = path.resolve(__dirname, '..'); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) return path.join(dir, 'runtime');
    if (path.dirname(dir) === dir) throw new Error('Run inside the public PALE checkout or set PALE_RUNTIME_ROOT.');
  }
}
const runtime = runtimeRoot();
const {prepare} = require(path.join(runtime, 'prepare.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const MINIMAL = require('../fixtures/minimal.json');
const model = require('../src/model.cjs');
const {round3} = require('../src/learner.cjs');

const F = 'alg-factoring', X = 'alg-expand';
const at = (day, time) => `2027-03-0${day}T${time}:00-05:00`;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let prepared;
const clients = [];
test.before(() => { prepared = prepare(path.resolve(__dirname, '..')); });
test.after(async () => { await Promise.allSettled(clients.map(c => c.close())); prepared?.cleanup(); });
async function open(role, run, initialProfile) {
  const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'milepost-runtime-test', {registry: prepared.registry, initialProfile});
  clients.push(c); await c.initialize(); return c;
}
// Only Infra chooses the run's policy profile; the Agent connection then uses it.
async function session(run, profile = 'sandbox') {
  const infra = await open('infra', run, profile);
  return {infra, agent: await open('agent', run)};
}
const toolNames = async c => (await c.request('tools/list')).result.tools.map(t => t.name).sort();

// A student with history: a done block and its platform session, a reported session and a posted result.
function history() {
  const d = structuredClone(MINIMAL);
  d.plan.push({id: 'blk-1', skill_id: F, start: at(2, '19:00'), minutes: 40, created_at: at(1, '09:00'), updated_at: at(2, '19:40'), done: true});
  d.practice.push({id: 'ses-1', skill_id: F, minutes: 40, ended_at: at(2, '19:40'), source: 'platform', block_id: 'blk-1', recorded_at: at(2, '19:40')},
    {id: 'ses-2', skill_id: F, minutes: 30, ended_at: at(3, '20:00'), source: 'student_report', block_id: null, recorded_at: at(3, '21:00')});
  d.results.push({id: 'res-1', assessment_id: 'check-1', posted_at: at(4, '10:00'), levels: [{skill_id: F, level: 0.5}]});
  return d;
}

test('discovery: profiles limit the Agent tools; Infra operations stay off the Agent connection', async () => {
  const scenario = (await session('discovery-a', 'scenario')).agent, sandbox = (await session('discovery-b')).agent;
  const s = await toolNames(scenario), all = await toolNames(sandbox);
  assert.equal(all.length, 13);
  assert.deepEqual(all.filter(n => !s.includes(n)), ['milepost.practice.record', 'milepost.practice.remove']);
  assert.ok(all.every(n => n.startsWith('milepost.')));
  for (const name of ['env.snapshot', 'env.load_seed', 'env.reset', 'env.apply_event', 'env.advance_time']) {
    assert.equal((await sandbox.call(name, {})).status, 'permission_denied');
  }
});

test('history loads at the task time; MCP reads equal the business functions on the committed state', async () => {
  const {infra, agent} = await session('history');
  const v0 = (await infra.call('env.snapshot')).version;
  const loaded = await infra.call('env.load_seed', {expected_version: v0, request_id: 'load-1', data: history(), virtual_now: at(4, '12:00')});
  assert.equal(loaded.status, 'ready');
  const snap = (await infra.call('env.snapshot')).snapshot;
  assert.equal(snap.virtual_now, at(4, '12:00'));
  const mastery = await agent.call('milepost.mastery.get', {});
  const expected = model.learnerModel(snap.data);
  assert.equal(mastery.as_of, at(4, '12:00'));
  for (const s of mastery.skills) assert.equal(s.level, round3(expected.levelAt(s.skill_id, at(4, '12:00'))));
  assert.equal(mastery.skills.find(s => s.skill_id === F).level, round3(0.5 * Math.pow(0.9, (2 / 24) / expected.stateAt(F, at(4, '12:00')).S)));
  assert.deepEqual((await agent.call('milepost.plan.list')).blocks.map(b => [b.id, b.status]), [['blk-1', 'done']]);
  assert.equal((await infra.call('env.snapshot')).snapshot.revision, snap.revision, 'Reads change nothing');
});

test('writes: retries return the first result, conflicts and stale versions are refused, refusals change nothing', async () => {
  const {infra, agent} = await session('writes');
  let version = (await agent.call('milepost.plan.list')).version;
  const args = {skill_id: F, start: at(2, '19:00'), minutes: 40, expected_version: version, request_id: 'req-1'};
  const first = await agent.call('milepost.plan.add_block', args);
  assert.deepEqual([first.status, first.id, first.version.revision], ['committed', 'blk-1', version.revision + 1]);
  const again = await agent.call('milepost.plan.add_block', args);
  assert.deepEqual([again.duplicate, again.id], [true, 'blk-1']);
  assert.equal((await agent.call('milepost.plan.add_block', {...args, minutes: 30})).status, 'idempotency_conflict');
  assert.equal((await agent.call('milepost.plan.add_block', {...args, start: at(3, '19:00'), request_id: 'req-2'})).status, 'stale_version');
  const before = (await infra.call('env.snapshot')).snapshot;
  version = (await agent.call('milepost.plan.list')).version;
  const overlap = await agent.call('milepost.plan.add_block', {skill_id: X, start: at(2, '19:20'), minutes: 30, expected_version: version, request_id: 'req-3'});
  assert.deepEqual([overlap.status, overlap.applied], ['overlap', false]);
  const after = (await infra.call('env.snapshot')).snapshot;
  assert.equal(hash(after.data), hash(before.data));
  const log = after.data.evaluator.activity_log;
  assert.deepEqual(log.map(e => [e.request_id, e.object_id]), [['req-1', 'blk-1']], 'Only the committed write is logged, once');
  const audit = after.audit.filter(a => a.tool === 'milepost.plan.add_block');
  assert.ok(audit.some(a => a.decision === 'allow' && a.state_changed) && audit.some(a => a.decision === 'deny' && a.reason === 'overlap'));
});

test('clock and events: advance_time fades mastery; a refused event changes neither data, clock nor version', async () => {
  const {infra, agent} = await session('clock');
  let snap = await infra.call('env.snapshot');
  const moved = await infra.call('env.advance_time', {expected_version: snap.version, virtual_now: at(4, '09:00'), request_id: 'clock-1'});
  assert.deepEqual([moved.status, moved.advanced], ['committed', true]);
  assert.equal((await agent.call('milepost.mastery.get', {skill_ids: [F]})).skills[0].level, 0.336);
  snap = await infra.call('env.snapshot');
  const added = await infra.call('env.apply_event', {expected_version: snap.version, event: require('../examples/scenario.json')});
  assert.equal(added.status, 'invalid_event', 'Events cannot be applied before the clock');
  snap = await infra.call('env.snapshot');
  const event = {event_id: 'ev-added', at: at(4, '12:00'), operation: 'milepost.assessment.added', payload: {assessment_id: 'quiz-4', date: '2027-03-08T10:00:00-05:00', targets: [{skill_id: X, level: 0.75}]}};
  assert.equal((await infra.call('env.apply_event', {expected_version: snap.version, event})).status, 'committed');
  const ok = await infra.call('env.snapshot');
  const refused = await infra.call('env.apply_event', {expected_version: ok.version,
    event: {event_id: 'ev-moved', at: at(4, '12:05'), operation: 'milepost.assessment.moved', payload: {assessment_id: 'quiz-9', date: '2027-03-09T10:00:00-05:00'}}});
  assert.deepEqual([refused.status, refused.applied], ['unknown_reference', false]);
  const after = await infra.call('env.snapshot');
  assert.deepEqual([hash(after.snapshot.data), after.snapshot.virtual_now, after.version], [hash(ok.snapshot.data), at(4, '12:00'), ok.version]);
  assert.equal((await infra.call('env.event_status', {event_id: 'ev-added'})).receipt.status, 'committed');
});

test('reset restores the loaded data and clock; the evaluator-only records never reach the Agent', async () => {
  const {infra, agent} = await session('reset');
  const data = history(), marker = 'MARKER-EVAL-ONLY-42';
  data.evaluator.activity_log.push({seq: 1, at: at(1, '09:00'), operation: 'milepost.plan.add_block', request_id: marker,
    expected_version: {epoch: 1, revision: 0}, object_id: marker, details: {note: marker}});
  const v0 = (await infra.call('env.snapshot')).version;
  assert.equal((await infra.call('env.load_seed', {expected_version: v0, request_id: 'load-r', data, virtual_now: at(4, '12:00')})).status, 'ready');
  const loaded = (await infra.call('env.snapshot')).snapshot;
  const version = (await agent.call('milepost.plan.list')).version;
  assert.equal((await agent.call('milepost.plan.add_block', {skill_id: X, start: at(4, '19:00'), minutes: 30, expected_version: version, request_id: 'req-r'})).status, 'committed');
  const text = [];
  for (const t of (await agent.request('tools/list')).result.tools.filter(t => t.annotations.readOnlyHint)) {
    text.push(JSON.stringify(await agent.call(t.name, t.name.endsWith('project') ? {assessment_id: 'quiz-3'} : {})));
  }
  assert.ok(!text.join('').includes(marker) && !text.join('').includes('learner_params'));
  assert.ok(JSON.stringify((await infra.call('env.snapshot')).snapshot.data).includes(marker), 'Infra snapshots keep evaluator records');
  const current = await infra.call('env.snapshot');
  assert.equal((await infra.call('env.reset', {expected_version: current.version})).status, 'ready');
  const restored = (await infra.call('env.snapshot')).snapshot;
  assert.deepEqual([hash(restored.data), restored.virtual_now], [hash(loaded.data), loaded.virtual_now]);
  assert.ok(restored.epoch > current.snapshot.epoch);
});

// The full fixtures load as complete bundles: provenance and counts are checked strictly by the Core, so a
// student never arrives as an unidentified record import.
for (const id of ['maya', 'daniel']) {
  test(`full fixture ${id}: loads through env.load_seed with its bundle; reset returns to it`, async () => {
    const dir = path.join(__dirname, '../fixtures/students', id), read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/profiles', id + '.json'), 'utf8'));
    const data = read('seed.json'), dataset = read('dataset.json');
    const {infra, agent} = await session('full-' + id);
    const v0 = (await infra.call('env.snapshot')).version;
    const loaded = await infra.call('env.load_seed', {expected_version: v0, request_id: 'load-' + id, data, binding: read('binding.json'),
      bundle: {dataset, catalog: read('catalog.json'), blobs: {}}, virtual_now: profile.now});
    assert.equal(loaded.status, 'ready');
    assert.equal(loaded.quality.automated_pass, true);
    assert.equal(loaded.quality.dataset_id, 'milepost-student-' + id);
    assert.deepEqual(loaded.quality.counts.records, dataset.expected_counts.records);
    assert.ok(loaded.quality.checks.some(c => c.name === 'expected_counts' && c.status === 'pass'), 'Counts are checked strictly');
    assert.deepEqual(loaded.quality.warnings, ['Realism, variation and licensing still require human review.']);
    const mastery = await agent.call('milepost.mastery.get', {});
    assert.equal(mastery.skills.length, 60);
    assert.equal(mastery.as_of, profile.now);
    const snap = (await infra.call('env.snapshot')).snapshot;
    assert.equal(hash(snap.data), hash(data));
    const version = (await agent.call('milepost.plan.list')).version;
    assert.equal((await agent.call('milepost.plan.add_block', {skill_id: 'bio-5-2', start: '2027-03-02T19:00:00-05:00', minutes: 40,
      expected_version: version, request_id: 'req-' + id})).status, 'committed');
    const current = await infra.call('env.snapshot');
    assert.equal((await infra.call('env.reset', {expected_version: current.version})).status, 'ready');
    const restored = (await infra.call('env.snapshot')).snapshot;
    assert.deepEqual([hash(restored.data), restored.virtual_now], [hash(data), profile.now]);
  });
}

// The reference scenarios end to end over MCP: Infra loads the bundle and applies the setup (events and clock
// moves) in order; the Agent runs the reference with versions and request IDs; the grader reads env.snapshot.
const {grade} = require('../examples/scenarios/grade.cjs');
const {scenarios} = require('../scripts/build-scenarios.cjs');
async function scenarioRun(spec, variant, calls, label) {
  const dir = path.join(__dirname, '../examples/scenarios', spec.id, variant), read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const {infra, agent} = await session(`${spec.id}-${variant}-${label}`, spec.assessment_id ? 'scenario' : 'sandbox');
  const loaded = await infra.call('env.load_seed', {expected_version: (await infra.call('env.snapshot')).version, request_id: 'load', data: read('seed.json'),
    binding: read('binding.json'), bundle: {dataset: read('dataset.json'), catalog: read('catalog.json'), blobs: {}}, virtual_now: spec.load_at});
  assert.equal(loaded.status, 'ready');
  for (const [i, step] of spec.setup.entries()) {
    const expected_version = (await infra.call('env.snapshot')).version;
    const r = step.event ? await infra.call('env.apply_event', {expected_version, event: step.event})
      : await infra.call('env.advance_time', {expected_version, virtual_now: step.advance_to, request_id: 'setup-' + i});
    assert.equal(r.status, 'committed', JSON.stringify(r));
  }
  let refused = 0;
  for (const [i, [name, args]] of calls.entries()) {
    const expected_version = (await agent.call('milepost.plan.list')).version;
    const r = await agent.call(name, {...args, expected_version, request_id: 'req-' + i});
    if (r.status !== 'committed') refused++;
  }
  const snap = (await infra.call('env.snapshot')).snapshot;
  assert.equal(snap.virtual_now, spec.ask_at);
  return {result: grade(snap, spec, variant), refused};
}
for (const spec of scenarios()) {
  test(`scenario ${spec.id}: setup and references run through the real Core; the twin answer fails the base and vice versa`, async () => {
    for (const variant of ['base', 'twin']) {
      const {result, refused} = await scenarioRun(spec, variant, spec.runs[variant].reference, 'ref');
      assert.deepEqual([result.pass, refused], [true, 0], JSON.stringify(result.checks.filter(c => !c.pass)));
    }
    assert.equal((await scenarioRun(spec, 'base', spec.runs.twin.reference, 'cross')).result.pass, false);
    const control = spec.runs.base.controls.find(c => c.expect_refused) || spec.runs.base.controls[0];
    const {result, refused} = await scenarioRun(spec, 'base', control.calls, 'control');
    assert.deepEqual([result.checks.filter(c => !c.pass).map(c => c.name), refused], [control.fails, control.expect_refused || 0], control.name);
  });
}
