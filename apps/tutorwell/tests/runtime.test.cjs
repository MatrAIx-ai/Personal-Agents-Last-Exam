'use strict';
// Real public-runtime checks: MCP discovery, Core versions and receipts, history loading, events, the clock, reset
// and the evaluator-only boundary. Needs the public PALE checkout (or PALE_RUNTIME_ROOT). From its root:
//   node --test apps/tutorwell/tests/runtime.test.cjs
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
const {history, at, MATH, WRITING} = require('./seeds.cjs');
const {checkAppointments} = require('../src/checker.cjs');

const T = 'tutorwell.';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let prepared;
const clients = [];
test.before(() => { prepared = prepare(path.resolve(__dirname, '..')); });
test.after(async () => { await Promise.allSettled(clients.map(c => c.close())); prepared?.cleanup(); });
async function open(role, run, initialProfile) {
  const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'tutorwell-runtime-test', {registry: prepared.registry, initialProfile});
  clients.push(c); await c.initialize(); return c;
}
// Only Infra chooses the run's policy profile; the Agent connection then uses it.
async function session(run, profile = 'scenario') {
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
const write = async (agent, name, args, request_id) => {
  const {version} = await agent.call(T + 'profile.get', {});
  return agent.call(T + name, {...args, expected_version: version, request_id});
};
const apply = async (infra, event) => infra.call('env.apply_event', {expected_version: (await infra.call('env.snapshot')).version, event});

test('discovery: each profile offers exactly its ten tools; Infra operations stay off the Agent connection', async () => {
  const policies = require('../fixtures/policies.json');
  for (const profile of ['scenario', 'sandbox']) {
    const {agent} = await session('discovery-' + profile, profile);
    assert.deepEqual(await toolNames(agent), [...policies[profile].allow].sort());
  }
  const {agent} = await session('discovery-ops');
  assert.equal((await toolNames(agent)).length, 10);
  for (const name of ['env.snapshot', 'env.load_seed', 'env.reset', 'env.apply_event', 'env.advance_time']) assert.equal((await agent.call(name, {})).status, 'permission_denied');
});

test('history loads at the task time; every read gives as_of in the student\'s zone and changes nothing', async () => {
  const {infra, agent} = await session('history');
  const snap = await load(infra, history(), '2027-03-08T14:30:00Z');
  assert.equal(snap.virtual_now, '2027-03-08T14:30:00Z');
  for (const name of ['services.list', 'tutors.list', 'slots.list', 'appointments.list', 'reports.list', 'profile.get']) {
    assert.equal((await agent.call(T + name, {})).as_of, '2027-03-08T09:30:00-05:00', name);
  }
  const list = await agent.call(T + 'appointments.list', {});
  assert.deepEqual(list.appointments.map(a => [a.id, a.status]), [['apt-h1', 'completed'], ['apt-h2', 'cancelled'], ['apt-p1', 'no_show']]);
  assert.deepEqual((await agent.call(T + 'reports.list', {})).reports.map(r => r.id), ['rep-h1']);
  const p = await agent.call(T + 'profile.get', {});
  assert.deepEqual([p.time_zone, p.no_shows.in_window, p.suspension], ['America/New_York', 1, null]);
  assert.equal((await infra.call('env.snapshot')).snapshot.revision, snap.revision, 'Reads change nothing');
});

test('writes: retries return the first result, conflicts and stale versions are refused, refusals change nothing', async () => {
  const {infra, agent} = await session('writes');
  const {version} = await agent.call(T + 'slots.list', {});
  const args = {slot_id: 's1', intake: MATH, expected_version: version, request_id: 'req-1'};
  const first = await agent.call(T + 'appointments.book', args);
  assert.deepEqual([first.status, first.id, first.appointment_status, first.cancellation_cutoff, first.version.revision],
    ['committed', 'apt-1', 'booked', '2027-03-09T04:00:00-05:00', version.revision + 1]);
  const again = await agent.call(T + 'appointments.book', args);
  assert.deepEqual([again.duplicate, again.id], [true, 'apt-1']);
  assert.equal((await agent.call(T + 'appointments.book', {...args, slot_id: 's2'})).status, 'idempotency_conflict');
  assert.equal((await agent.call(T + 'appointments.book', {slot_id: 's3', intake: WRITING, expected_version: version, request_id: 'req-2'})).status, 'stale_version');
  const before = (await infra.call('env.snapshot')).snapshot;
  await write(agent, 'appointments.book', {slot_id: 's3', intake: WRITING}, 'req-3');
  const capped = await write(agent, 'appointments.book', {slot_id: 's2', intake: MATH}, 'req-4');
  assert.deepEqual([capped.status, capped.applied], ['weekly_cap', false]);
  // The week is full, so a draftless writing booking gets weekly_cap first (the order tools.json gives).
  const draftless = await write(agent, 'appointments.book', {slot_id: 's4', intake: {...WRITING, draft_ref: null}}, 'req-5');
  assert.equal(draftless.status, 'weekly_cap');
  assert.equal((await write(agent, 'appointments.book', {slot_id: 's9', intake: MATH}, 'req-6')).status, 'not_found');
  const after = (await infra.call('env.snapshot')).snapshot;
  assert.equal(after.data.appointments.length, before.data.appointments.length + 1);
  const log = after.data.evaluator.activity_log;
  assert.deepEqual(log.map(e => [e.request_id, e.object_id]), [['req-1', 'apt-1'], ['req-3', 'apt-2']], 'Only committed writes are logged, once each');
  const audit = after.audit.filter(a => a.tool.startsWith(T));
  assert.ok(audit.some(a => a.decision === 'allow' && a.state_changed) && audit.some(a => a.decision === 'deny' && a.reason === 'weekly_cap'));
});

test('events and the clock: E7 over MCP; an early or refused event changes neither data, clock nor version', async () => {
  const {infra, agent} = await session('events');
  await write(agent, 'appointments.book', {slot_id: 's1', intake: MATH}, 'b1');
  let snap = await infra.call('env.snapshot');
  const early = await infra.call('env.apply_event', {expected_version: snap.version, event: {event_id: 'ev-early', at: at('03-08', '08:00'),
    operation: T + 'slot.withdrawn', payload: {slot_id: 's4'}}});
  assert.equal(early.status, 'invalid_event', 'Events cannot be applied before the clock');
  const moved = await infra.call('env.advance_time', {expected_version: snap.version, virtual_now: at('03-10', '09:00'), request_id: 'clock-1'});
  assert.deepEqual([moved.status, moved.advanced], ['committed', true]);
  assert.equal((await agent.call(T + 'appointments.list', {})).appointments.find(a => a.id === 'apt-1').status, 'awaiting_outcome');
  await write(agent, 'appointments.book', {slot_id: 's2', intake: MATH}, 'b2');
  const ok = await infra.call('env.snapshot');
  const refused = await infra.call('env.apply_event', {expected_version: ok.version, event: {event_id: 'ev-r', at: at('03-10', '09:30'), operation: T + 'report.posted',
    payload: {appointment_id: 'apt-1', covered_skill_ids: ['alg-factoring'], followups: []}}});
  assert.deepEqual([refused.status, refused.applied], ['invalid_state', false]);
  const unchanged = await infra.call('env.snapshot');
  assert.deepEqual([hash(unchanged.snapshot.data), unchanged.snapshot.virtual_now, unchanged.version], [hash(ok.snapshot.data), at('03-10', '09:00'), ok.version]);
  const noShow = {event_id: 'ev-att', at: at('03-11', '10:00'), operation: T + 'appointment.attended', payload: {appointment_id: 'apt-1', outcome: 'no_show'}};
  assert.equal((await apply(infra, noShow)).status, 'committed');
  assert.equal((await infra.call('env.event_status', {event_id: 'ev-att'})).receipt.status, 'committed');
  assert.deepEqual((await agent.call(T + 'profile.get', {})).suspension,
    {from: '2027-03-11T10:00:00-05:00', until: '2027-03-25T11:00:00-04:00', cause: 'no_show', cause_appointment_id: 'apt-1'});
  const twice = await apply(infra, {...noShow, event_id: 'ev-att-2', at: at('03-11', '10:05'), payload: {appointment_id: 'apt-1', outcome: 'completed'}});
  assert.equal(twice.status, 'invalid_state');
  const c = checkAppointments((await infra.call('env.snapshot')).snapshot);
  assert.deepEqual([c.as_of, c.suspensions.map(s => s.cause_appointment_id)], ['2027-03-11T10:00:00-05:00', ['apt-1']]);
});

test('reset restores the loaded data and clock; the evaluator-only records never reach the Agent', async () => {
  const {infra, agent} = await session('reset');
  const data = history(), marker = 'MARKER-EVAL-ONLY-73';
  data.evaluator.activity_log.push({seq: 1, at: at('03-07', '12:00'), operation: T + 'appointments.book', request_id: marker, expected_version: {epoch: 1, revision: 0},
    object_id: marker, appointment_id: marker, consents: [{accommodation_id: marker, consent_to_share: true}], details: {note: marker}});
  const loaded = await load(infra, data, at('03-08', '09:00'));
  assert.equal((await write(agent, 'appointments.book', {slot_id: 's2', intake: {...MATH, share_accommodations: true}}, 'req-r')).status, 'committed');
  const text = [];
  for (const t of (await agent.request('tools/list')).result.tools.filter(t => t.annotations.readOnlyHint)) text.push(JSON.stringify(await agent.call(t.name, {})));
  for (const hidden of [marker, 'activity_log', '"consents"', 'shared_without_consent']) assert.ok(!text.join('').includes(hidden), hidden);
  const snap = (await infra.call('env.snapshot')).snapshot;
  assert.ok(JSON.stringify(snap.data).includes(marker), 'Infra snapshots keep evaluator records');
  assert.deepEqual(checkAppointments(snap).intakes.at(-1).shared_without_consent, ['acc-1']);
  const current = await infra.call('env.snapshot');
  assert.equal((await infra.call('env.reset', {expected_version: current.version})).status, 'ready');
  const restored = (await infra.call('env.snapshot')).snapshot;
  assert.deepEqual([hash(restored.data), restored.virtual_now], [hash(loaded.data), loaded.virtual_now]);
  assert.ok(restored.epoch > current.snapshot.epoch);
});

test('both full fixtures load as bundles with strict provenance and counts', async () => {
  for (const id of ['daniel', 'maya']) {
    const {infra, agent} = await session('fixture-' + id);
    const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/students', id, f), 'utf8'));
    const v0 = (await infra.call('env.snapshot')).version;
    const r = await infra.call('env.load_seed', {expected_version: v0, request_id: 'load-' + id, data: read('seed.json'), binding: read('binding.json'),
      bundle: {dataset: read('dataset.json'), catalog: read('catalog.json'), blobs: {}}, virtual_now: '2027-03-01T09:00:00-05:00'});
    assert.equal(r.status, 'ready', id + ': ' + (r.message || ''));
    assert.equal(r.quality.automated_pass, true);
    assert.equal(r.quality.counts.records, read('dataset.json').expected_counts.records);
    assert.equal((await agent.call(T + 'appointments.list', {})).appointments.length, 12);
    assert.equal((await agent.call(T + 'profile.get', {})).as_of, '2027-03-01T09:00:00-05:00');
  }
});

test('the four reference scenarios play over MCP: each reference passes its member and fails the other', async () => {
  const {play} = require('../examples/scenarios/play.cjs');
  const {scenarios} = require('../scripts/build-scenarios.cjs');
  const out = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tutorwell-runtime-'));
  try {
    for (const s of scenarios()) {
      for (const variant of ['base', 'twin']) {
        const r = await play(s.id, variant, 'reference', path.join(out, s.id + '-' + variant));
        assert.ok(r.grade.pass, `${s.id}/${variant}: ${JSON.stringify(r.grade.checks.filter(c => !c.pass))}`);
        assert.ok(r.steps.every(([, status]) => ['ready', 'committed', 'ok'].includes(status)), `${s.id}/${variant} steps: ${JSON.stringify(r.steps)}`);
      }
      const crossed = await play(s.id, 'twin', 'control-1', path.join(out, s.id + '-cross'));
      assert.equal(crossed.grade.pass, false, `${s.id}: the twin's first control (the base's decision) fails`);
    }
  } finally { fs.rmSync(out, {recursive: true, force: true}); }
});
