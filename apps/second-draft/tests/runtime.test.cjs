'use strict';
// Real public-runtime checks: MCP discovery, Core versions and receipts, history loading, events, the clock,
// reset and the evaluator-only boundary. Needs the public PALE checkout (or PALE_RUNTIME_ROOT). From its root:
//   node --test apps/second-draft/tests/runtime.test.cjs
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
const {history, at} = require('./seeds.cjs');
const {checkAssignment} = require('../src/checker.cjs');

const A = 'hist-essay-2', T = hm => at('03-08', hm);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let prepared;
const clients = [];
test.before(() => { prepared = prepare(path.resolve(__dirname, '..')); });
test.after(async () => { await Promise.allSettled(clients.map(c => c.close())); prepared?.cleanup(); });
async function open(role, run, initialProfile) {
  const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'second-draft-runtime-test', {registry: prepared.registry, initialProfile});
  clients.push(c); await c.initialize(); return c;
}
// Only Infra chooses the run's policy profile; the Agent connection then uses it.
async function session(run, profile = 'sandbox') {
  const infra = await open('infra', run, profile);
  return {infra, agent: await open('agent', run)};
}
const toolNames = async c => (await c.request('tools/list')).result.tools.map(t => t.name).sort();
async function load(infra, data, virtual_now) {
  const v0 = (await infra.call('env.snapshot')).version;
  const r = await infra.call('env.load_seed', {expected_version: v0, request_id: 'load-' + virtual_now, data, virtual_now});
  assert.equal(r.status, 'ready');
  return (await infra.call('env.snapshot')).snapshot;
}

test('discovery: the scenario profile leaves out submission; Infra operations stay off the Agent connection', async () => {
  const scenario = (await session('discovery-a', 'scenario')).agent, sandbox = (await session('discovery-b')).agent;
  const s = await toolNames(scenario), all = await toolNames(sandbox);
  assert.equal(all.length, 16);
  assert.deepEqual(all.filter(n => !s.includes(n)), ['second-draft.submissions.submit']);
  assert.ok(all.every(n => n.startsWith('second-draft.')));
  for (const name of ['env.snapshot', 'env.load_seed', 'env.reset', 'env.apply_event', 'env.advance_time']) {
    assert.equal((await sandbox.call(name, {})).status, 'permission_denied');
  }
});

test('history loads at the task time; MCP reads equal the business functions on the committed state', async () => {
  const {infra, agent} = await session('history');
  const snap = await load(infra, history(), T('09:30'));
  assert.equal(snap.virtual_now, T('09:30'));
  const list = await agent.call('second-draft.assignments.list', {});
  assert.equal(list.as_of, T('09:30'));
  assert.deepEqual(list.assignments.map(a => [a.id, a.status]), [['hist-essay-2', 'open'], ['hist-essay-1', 'graded'], ['comp-reflection-1', 'open']]);
  const draft = await agent.call('second-draft.drafts.get', {assignment_id: A});
  assert.deepEqual([draft.draft.id, draft.draft.authorship], ['v1', {student: 100}]);
  assert.equal((await agent.call('second-draft.comments.list', {assignment_id: 'hist-essay-1'})).comments[0].status, 'resolved');
  assert.equal((await infra.call('env.snapshot')).snapshot.revision, snap.revision, 'Reads change nothing');
});

test('writes: retries return the first result, conflicts and stale versions are refused, refusals change nothing', async () => {
  const {infra, agent} = await session('writes');
  let version = (await agent.call('second-draft.checklist.get', {assignment_id: A})).version;
  const args = {assignment_id: A, items: [{text: 'Thesis first', comment_ids: ['c1']}], expected_version: version, request_id: 'req-1'};
  const first = await agent.call('second-draft.checklist.save', args);
  assert.deepEqual([first.status, first.id, first.version.revision], ['committed', 'chk-1', version.revision + 1]);
  const again = await agent.call('second-draft.checklist.save', args);
  assert.deepEqual([again.duplicate, again.id], [true, 'chk-1']);
  assert.equal((await agent.call('second-draft.checklist.save', {...args, items: [{text: 'Other'}]})).status, 'idempotency_conflict');
  assert.equal((await agent.call('second-draft.comments.set_status', {comment_id: 'c1', status: 'addressed', expected_version: version, request_id: 'req-2'})).status, 'stale_version');
  const before = (await infra.call('env.snapshot')).snapshot;
  version = (await agent.call('second-draft.checklist.get', {assignment_id: A})).version;
  const bad = await agent.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p2', quote: 'it', replacement: 'that', expected_version: version, request_id: 'req-3'});
  assert.deepEqual([bad.status, bad.applied], ['invalid_quote', false]);
  const after = (await infra.call('env.snapshot')).snapshot;
  assert.equal(hash(after.data), hash(before.data));
  const log = after.data.evaluator.activity_log;
  assert.deepEqual(log.map(e => [e.request_id, e.object_id, e.action]), [['req-1', 'chk-1', 'plan']], 'Only the committed write is logged, once');
  const audit = after.audit.filter(a => a.tool.startsWith('second-draft.'));
  assert.ok(audit.some(a => a.decision === 'allow' && a.state_changed) && audit.some(a => a.decision === 'deny' && a.reason === 'invalid_quote'));
});

test('events and the clock: the proposal\'s example accepts sug-1; a refused event changes neither data, clock nor version', async () => {
  const {infra, agent} = await session('events');
  let version = (await agent.call('second-draft.drafts.get', {assignment_id: A})).version;
  const created = await agent.call('second-draft.suggestions.create', {assignment_id: A, paragraph_id: 'p3', quote: 'quickly, readers', replacement: 'quickly, so readers', expected_version: version, request_id: 'sug'});
  assert.equal(created.id, 'sug-1');
  let snap = await infra.call('env.snapshot');
  const early = await infra.call('env.apply_event', {expected_version: snap.version, event: {...require('../examples/events/suggestion-decided.json'), at: T('08:00')}});
  assert.equal(early.status, 'invalid_event', 'Events cannot be applied before the clock');
  snap = await infra.call('env.snapshot');
  assert.equal((await infra.call('env.apply_event', {expected_version: snap.version, event: require('../examples/events/suggestion-decided.json')})).status, 'committed');
  const v2 = (await agent.call('second-draft.drafts.get', {assignment_id: A})).draft;
  assert.deepEqual([v2.id, v2.authorship], ['v2', {student: 74.4, suggestion: 25.6}]);
  const ok = await infra.call('env.snapshot');
  const refused = await infra.call('env.apply_event', {expected_version: ok.version, event: {event_id: 'ev-bad', at: T('11:30'), operation: 'second-draft.comment.posted',
    payload: {comment_id: 'c4', assignment_id: A, version_id: 'v1', paragraph_id: 'p2', quote: 'the printing press', from: 'peer', text: 'x'}}});
  assert.deepEqual([refused.status, refused.applied], ['invalid_value', false]);
  const after = await infra.call('env.snapshot');
  assert.deepEqual([hash(after.snapshot.data), after.snapshot.virtual_now, after.version], [hash(ok.snapshot.data), T('11:00'), ok.version]);
  assert.equal((await infra.call('env.event_status', {event_id: 'ev-3'})).receipt.status, 'committed');
  const moved = await infra.call('env.advance_time', {expected_version: after.version, virtual_now: T('12:00'), request_id: 'clock-1'});
  assert.deepEqual([moved.status, moved.advanced], ['committed', true]);
  assert.equal((await agent.call('second-draft.policies.get', {})).as_of, T('12:00'));
  const c = checkAssignment((await infra.call('env.snapshot')).snapshot, {assignment_id: A});
  assert.deepEqual([c.versions.length, c.not_allowed], [2, []]);
});

test('reset restores the loaded data and clock; the evaluator-only records never reach the Agent', async () => {
  const {infra, agent} = await session('reset');
  const data = history(), marker = 'MARKER-EVAL-ONLY-42';
  data.evaluator.activity_log.push({seq: 1, at: T('08:00'), operation: 'second-draft.checklist.save', request_id: marker, expected_version: {epoch: 1, revision: 0},
    object_id: marker, assignment_id: A, course_id: 'hist-210', action: 'plan', kind: null, course_policy: ['plan'], student_rules: ['plan'], details: {note: marker}});
  const loaded = await load(infra, data, T('09:30'));
  const version = (await agent.call('second-draft.drafts.get', {assignment_id: A})).version;
  assert.equal((await agent.call('second-draft.drafts.edit', {assignment_id: A, paragraph_id: 'p1', text: 'A new opening.', expected_version: version, request_id: 'req-r'})).status, 'committed');
  const args = {'second-draft.drafts.list': {assignment_id: A}, 'second-draft.drafts.get': {assignment_id: A}, 'second-draft.comments.list': {assignment_id: A},
    'second-draft.checklist.get': {assignment_id: A}, 'second-draft.drafts.diff': {assignment_id: A, from_version_id: 'v1', to_version_id: 'v2'}};
  const text = [];
  for (const t of (await agent.request('tools/list')).result.tools.filter(t => t.annotations.readOnlyHint)) text.push(JSON.stringify(await agent.call(t.name, args[t.name] || {})));
  for (const hidden of [marker, 'activity_log', 'touched', 'student_rules']) assert.ok(!text.join('').includes(hidden), hidden);
  assert.ok(JSON.stringify((await infra.call('env.snapshot')).snapshot.data).includes(marker), 'Infra snapshots keep evaluator records');
  const current = await infra.call('env.snapshot');
  assert.equal((await infra.call('env.reset', {expected_version: current.version})).status, 'ready');
  const restored = (await infra.call('env.snapshot')).snapshot;
  assert.deepEqual([hash(restored.data), restored.virtual_now], [hash(loaded.data), loaded.virtual_now]);
  assert.ok(restored.epoch > current.snapshot.epoch);
});

test('both full fixtures load as bundles with strict provenance and counts', async () => {
  for (const id of ['priya', 'marcus']) {
    const {infra, agent} = await session('fixture-' + id);
    const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/students', id, f), 'utf8'));
    const v0 = (await infra.call('env.snapshot')).version;
    const r = await infra.call('env.load_seed', {expected_version: v0, request_id: 'load-' + id, data: read('seed.json'), binding: read('binding.json'),
      bundle: {dataset: read('dataset.json'), catalog: read('catalog.json'), blobs: {}}, virtual_now: T('09:00')});
    assert.equal(r.status, 'ready', id + ': ' + (r.message || ''));
    assert.equal(r.quality.automated_pass, true);
    assert.equal(r.quality.counts.records, read('dataset.json').expected_counts.records);
    assert.equal((await agent.call('second-draft.assignments.list', {})).assignments.length, 3);
  }
});

test('the four reference scenarios play over MCP: each reference passes its member and fails the other', async () => {
  const {play} = require('../examples/scenarios/play.cjs');
  const {scenarios} = require('../scripts/build-scenarios.cjs');
  const out = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'second-draft-runtime-'));
  try {
    for (const s of scenarios()) {
      for (const variant of ['base', 'twin']) {
        const r = await play(s.id, variant, 'reference', path.join(out, s.id + '-' + variant));
        assert.ok(r.grade.pass, `${s.id}/${variant}: ${JSON.stringify(r.grade.checks.filter(c => !c.pass))}`);
        assert.ok(r.steps.every(([, status]) => ['ready', 'committed'].includes(status)), `${s.id}/${variant} steps: ${JSON.stringify(r.steps)}`);
      }
      const crossed = await play(s.id, 'twin', 'control-1', path.join(out, s.id + '-cross'));
      assert.equal(crossed.grade.pass, false, `${s.id}: the twin's first control (the base reference or no action) fails`);
    }
  } finally { fs.rmSync(out, {recursive: true, force: true}); }
});
