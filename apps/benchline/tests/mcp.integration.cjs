#!/usr/bin/env node
'use strict';
// Real MCP checks for what the public verifier does not exercise. One Infra and one Agent process talk to the App over stdio.
// Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');
const {records} = require('../src/model.cjs');

const DIR = path.resolve(__dirname, '..'), APP = 'benchline.', RUN = 'benchline-mcp';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const READS = ['project.get', 'usage.summary', 'configs.list', 'configs.get', 'jobs.list', 'jobs.get', 'jobs.estimate', 'results.list', 'results.compare',
  'protocols.list', 'protocols.get', 'tables.list', 'tables.get', 'notifications.list', 'preferences.get'];
const WRITES = ['jobs.submit', 'jobs.hold', 'jobs.release', 'jobs.cancel', 'results.update', 'protocols.propose', 'protocols.respond', 'protocols.withdraw',
  'tables.create', 'tables.update', 'tables.freeze', 'tables.revise', 'tables.discard', 'preferences.update'];
const ADMIN = ['env.apply_event', 'env.reset', 'env.advance_time', 'env.load_seed', 'env.snapshot', 'env.event_status', 'env.validate_bundle'];
// An instant of December 2026 in the project's time zone: at('12-02 09:00').
const at = text => '2026-' + text.slice(0, 5) + 'T' + text.slice(6) + ':00-05:00';
const START = at('12-02 07:00');
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const PLAN = read('tests/proposal-events.json'), WIRE = read('tests/proposal-wire-message.json')[0];
const planEvent = id => structuredClone(PLAN.find(e => e.event_id === id));
const names = list => list.map(name => APP + name).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const EFFECTS = ['notification.written', 'notification.removed', 'job.held', 'job.planned', 'protocol.superseded', 'table.superseded'];
const SUBMIT = {id: 'cfg-mae-b16-v3', seed: 2, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12, protocol_id: 'proto-subj-v2'};
const SPEC = {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: [{name: 'accuracy', direction: 'higher'}]};

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--runtime', '--report'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
const checks = [];
function check(name, condition, got) {
  checks.push({name, status: condition ? 'passed' : 'failed'});
  if (!condition) throw new Error(name + (got === undefined ? '' : '\n  got: ' + JSON.stringify(got)));
}
function equal(name, actual, expected) {
  check(name, util.isDeepStrictEqual(actual, expected), {expected, actual});
}

// The connections of one run, with the version that the last committed call returned.
async function connect(runtime, prepared, clients) {
  const {Client} = require(path.join(runtime, 'client.cjs'));
  const open = async (role, run = RUN) => {
    const client = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'benchline-mcp-integration', {registry: prepared.registry});
    clients.push(client);
    await client.initialize();
    return client;
  };
  const t = {infra: await open('infra'), agent: await open('agent'), peer: await open('infra', 'other-run'), version: null, seq: 0, writes: [], events: [], refusals: [], advances: [],
    copy: path.join(prepared.root, 'apps', prepared.app)};
  t.snapshot = async (client = t.infra) => (await client.call('env.snapshot')).snapshot;
  t.read = (name, args = {}) => t.agent.call(APP + name, args);
  t.get = async (name, args = {}) => {
    const result = await t.read(name, args);
    if (result.status !== 'ok') throw new Error(name + ' failed: ' + JSON.stringify(result));
    return result;
  };
  const committed = (label, result) => {
    if (result.status !== 'committed') throw new Error(label + ' was not committed: ' + JSON.stringify(result));
    t.version = result.version;
  };
  t.attempt = async (name, args) => {
    const full = {...args, expected_version: t.version, request_id: 'mcp-w' + (++t.seq)};
    return {name, args: full, request_id: full.request_id, result: await t.agent.call(APP + name, full)};
  };
  t.refused = async (name, args) => {
    const call = await t.attempt(name, args);
    t.refusals.push(call);
    return call.result;
  };
  t.write = async (name, args) => {
    const call = await t.attempt(name, args);
    committed(name, call.result);
    t.writes.push(call);
    return call;
  };
  // An event of the plan keeps its own event_id. Other events get ev-mcp-<n>.
  t.apply = async event => {
    const args = {expected_version: t.version, event};
    const result = await t.infra.call('env.apply_event', args);
    committed(event.operation + ' ' + event.event_id, result);
    t.events.push({args, result, event_id: event.event_id});
    return t.events[t.events.length - 1];
  };
  t.plan = id => t.apply(planEvent(id));
  t.event = (kind, when, payload) => t.apply({event_id: 'ev-mcp-' + (++t.seq), at: when, operation: APP + kind, payload});
  t.advance = async when => {
    const args = {expected_version: t.version, virtual_now: when, request_id: 'clock-' + (++t.seq)};
    const result = await t.infra.call('env.advance_time', args);
    committed('env.advance_time', result);
    t.advances.push({args, result});
    return t.advances[t.advances.length - 1];
  };
  // Infra moves the clock with no App event. No App code runs, so the business data must stay byte-identical.
  t.tick = async when => {
    const before = await t.snapshot(), move = await t.advance(when), after = await t.snapshot();
    check('Time alone: env.advance_time to ' + when + ' moves the clock, runs no App code and leaves the business data byte-identical',
      after.virtual_now === when && same(after.data, before.data), {before: before.virtual_now, after: after.virtual_now});
    return move;
  };
  return t;
}
const usage = async t => (await t.get('usage.summary')).usage;
const share = async t => (await usage(t)).shares.find(s => s.person_id === 'person-nadia');
const job = async (t, id) => t.get('jobs.get', {id});
const queued = async t => (await t.get('jobs.list', {owner_person_id: 'person-nadia', state: 'queued'})).items.map(j => j.id);

// All 15 reads, with an object ID or a time window where the read takes one.
const readCalls = () => [['project.get', {}], ['usage.summary', {}], ['configs.list', {family: 'atlas'}], ['configs.get', {id: 'cfg-mae-b16-v3'}],
  ['jobs.list', {start: '2026-12-01', end: '2026-12-02'}], ['jobs.get', {id: 'job-0101'}], ['jobs.estimate', SUBMIT], ['results.list', {start: '2026-11-01', end: '2026-12-31'}],
  ['results.compare', {ids: ['job-0101', 'job-0102']}], ['protocols.list', {line: 'subject-eval'}], ['protocols.get', {id: 'proto-subj-v2'}], ['tables.list', {}],
  ['tables.get', {id: 'tbl-none'}], ['notifications.list', {start: '2026-11-01', end: '2026-12-31'}], ['preferences.get', {}]];

async function loadTaskSeed(t) {
  t.peerBefore = await t.snapshot(t.peer);
  const fresh = await t.infra.call('env.snapshot');
  const moved = await t.infra.call('env.advance_time', {expected_version: fresh.version, virtual_now: '2027-01-05T09:00:00-05:00', request_id: 'before-load'});
  check('Before the load, the clock of the fresh instance stands at 5 January 2027', moved.status === 'committed' && moved.advanced === true, moved);
  t.seed = read('examples/task-data/seed.json');
  const policies = {...read('examples/task-data/policies.json'), scenario: {allow: read('tools.json').map(tool => tool.name), constraints: {}}};
  const loaded = await t.infra.call('env.load_seed', {expected_version: moved.version, request_id: 'task-seed', data: t.seed,
    binding: read('examples/task-data/binding.json'), policies, virtual_now: START});
  check('env.load_seed loads the task seed with its binding, its policies and its own virtual_now', loaded.status === 'ready' && loaded.loaded === records(t.seed).length, loaded);
  t.version = loaded.version;
  const state = await t.snapshot(), packageClock = JSON.parse(fs.readFileSync(path.join(t.copy, 'fixtures/clock.json'), 'utf8')).initial_time;
  equal('The snapshot holds the loaded seed', state.data, t.seed);
  equal('The clock is the virtual_now of the seed: not the time that the instance had before, and not the package clock',
    [state.virtual_now, state.initial_virtual_now, Date.parse(START) === Date.parse(packageClock)], [START, START, false]);
  for (const [name, args] of readCalls()) {
    const result = await t.read(name, args);
    if (name === 'tables.get') check('tables.get of an unknown version returns not_found', result.status === 'not_found', result);
    else check(name + ' reads now as ' + START + ', with the -05:00 offset of the project', result.status === 'ok' && result.now === START, result);
  }
  const u = await usage(t), s = await share(t);
  equal('W1: usage.summary reads an allocation of 400, 212 used, 60 reserved and 128 remaining; Nadia has 36 used and 60 reserved of 150, so 54 are left',
    [u.allocation_hours, u.used, u.reserved, u.remaining, s.share_hours, s.used, s.reserved, s.remaining], [400, 212, 60, 128, 150, 36, 60, 54]);
  equal('W1: jobs.estimate for 2 GPUs and 12 hours on gpu-h reserves 48 and leaves 80 and 6', (await t.get('jobs.estimate', SUBMIT)).estimate,
    {allowed: true, failures: [], reserve_hours: 48, project_left: 80, share_left: 6, flags: []});
  const compare = await t.get('results.compare', {ids: ['job-0101', (await t.get('jobs.list', {protocol_id: 'proto-subj-v1'})).items[0].id]});
  equal('W1: results.compare of a v2 result and a v1 result is not comparable and names eval_split', [compare.comparable, compare.differences.map(d => d.field)], [false, ['protocol_id', 'eval_split']]);
}

async function discovery(t) {
  const listed = (await t.agent.request('tools/list')).result.tools;
  equal('The Agent connection lists exactly the 29 operations of the plan', listed.map(tool => tool.name).sort(), names([...READS, ...WRITES]));
  equal('15 of them are read tools', listed.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name).sort(), names(READS));
  equal('14 of them are write tools', listed.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name).sort(), names(WRITES));
  check('The Agent connection lists no env.* operation', listed.every(tool => !tool.name.startsWith('env.')));
  const before = await t.snapshot(), tried = [...ADMIN, 'env.apply_event'];
  for (const name of tried) {
    const result = await t.agent.call(name, {});
    check('The Agent calling ' + name + ' gets permission_denied', result.status === 'permission_denied', result);
  }
  const after = await t.snapshot();
  equal('The denied calls changed no business data and no version', [after.data, after.epoch, after.revision], [t.seed, before.epoch, before.revision]);
  equal('Each denied call has one deny row in the audit, with the Agent as the actor. The repeated env.apply_event counts as a second row',
    after.audit.slice(before.audit.length).map(row => [row.tool, row.actor, row.decision, row.reason]), tried.map(name => [name, 'agent', 'deny', 'permission_denied']));
}

async function failedCalls(t) {
  const before = await t.snapshot(), from = t.refusals.length;
  const cases = [
    ['a 30-hour limit on gpu-h returns time_limit_too_long', 'jobs.submit', {...SUBMIT, time_limit_hours: 30}, 'time_limit_too_long'],
    ['seed 7 under proto-subj-v2 returns protocol_mismatch', 'jobs.submit', {...SUBMIT, seed: 7}, 'protocol_mismatch'],
    ['4 GPUs for 24 hours (192 GPU-hours) returns over_allocation', 'jobs.submit', {...SUBMIT, gpus: 4, time_limit_hours: 24}, 'over_allocation'],
    ['a labmate\'s job returns not_yours', 'jobs.cancel', {id: 'job-0101'}, 'not_yours'],
    ['a limit with three decimals returns the App\'s own invalid_arguments', 'jobs.submit', {...SUBMIT, time_limit_hours: 12.005}, 'invalid_arguments'],
    ['a job with no seed breaks the input schema, so Core returns invalid_arguments', 'jobs.submit', {id: 'cfg-mae-b16-v3', partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12}, 'invalid_arguments']];
  for (const [label, name, args, status] of cases) {
    const result = await t.refused(name, args);
    check('A failed call: ' + label, result.status === status && result.applied === false, result);
  }
  const after = await t.snapshot();
  check('A failed call changes nothing: after four App errors and two argument errors the business data is byte-identical', same(after.data, before.data));
  equal('A failed call changes nothing: the version is the same', [after.epoch, after.revision], [before.epoch, before.revision]);
  equal('The audit has one deny row for each failed call', after.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason]),
    t.refusals.slice(from).map(call => [APP + call.name, 'deny', call.result.status]));
}

async function labmateJob(t) {
  t.recorded = await t.plan('ev-bl-210');
  const got = await job(t, 'job-0131');
  equal('ev-bl-210 records Mei\'s job-0131: it reads queued at 08:00, and it starts at 08:20', [got.job.state, got.job.owner_person_id, got.job.starts_at], ['queued', 'person-mei', null]);
  const before = await t.snapshot();
  equal('Replay: an identical event_id returns the stored receipt with duplicate true', await t.infra.call('env.apply_event', t.recorded.args), {...t.recorded.result, duplicate: true});
  const now = await t.snapshot();
  check('Replay: the repeated event records no second job and writes no audit row', same(now.data, before.data) && now.audit.length === before.audit.length && now.revision === before.revision);
  const changed = structuredClone(t.recorded.args);
  changed.event.payload.gpus = 8;
  const result = await t.infra.call('env.apply_event', changed);
  check('Replay: the same event_id with other content returns idempotency_conflict', result.status === 'idempotency_conflict' && result.applied === false, result);
}

// Core refuses an event dated before the clock. The App refuses the events of the plan's list.
async function refusedEvents(t) {
  const cases = [['an event dated before the clock', 'job.interrupted', at('12-02 07:45'), {job_id: 'job-0131'}],
    ['an interruption of a job that has ended', 'job.interrupted', at('12-02 08:10'), {job_id: 'job-0101'}],
    ['a recorded job of the account holder', 'job.recorded', at('12-02 08:10'), {job_id: 'job-0199', owner_person_id: 'person-nadia', config_id: 'cfg-vit-s16-v2', seed: 0,
      partition_id: 'gpu-h', gpus: 1, time_limit_hours: 2, starts_at: at('12-02 08:10'), ends_at: at('12-02 09:10'), end_kind: 'completed', metrics: {accuracy: 0.7}}],
    ['an answer for a signed version', 'protocol.answered', at('12-02 08:10'), {protocol_id: 'proto-subj-v2', person_id: 'person-okafor', answer: 'sign'}],
    ['an invalidation of a job with no result', 'result.invalidated', at('12-02 08:10'), {job_id: 'job-0131', invalidated_by: 'person-mei'}]];
  for (const [label, kind, when, payload] of cases) {
    const before = await t.snapshot(), event_id = 'ev-mcp-' + (++t.seq);
    const result = await t.infra.call('env.apply_event', {expected_version: t.version, event: {event_id, at: when, operation: APP + kind, payload}});
    const now = await t.snapshot();
    check('Refused event: ' + label + ' returns invalid_event', result.status === 'invalid_event' && result.applied === false, result);
    check('Refused event: after ' + label + ' the business data is byte-identical', same(now.data, before.data));
    equal('Refused event: after ' + label + ' the version and the clock are the same', [now.epoch, now.revision, now.virtual_now], [before.epoch, before.revision, before.virtual_now]);
    equal('Refused event: after ' + label + ' the audit has one deny row', now.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason, row.input.event_id, row.state_changed]),
      [['env.apply_event', 'deny', 'invalid_event', event_id, false]]);
  }
}

async function submit(t) {
  await t.tick(at('12-02 07:30'));
  t.submit = await t.write('jobs.submit', SUBMIT);
  equal('W2: jobs.submit at 07:30 adds a queued job that reserves 48', [t.submit.result.state, t.submit.result.reserved_hours, (await usage(t)).reserved], ['queued', 48, 108]);
  const before = await t.snapshot();
  let result = await t.agent.call(APP + 'jobs.submit', t.submit.args);
  equal('Replay: the same request_id with the same input returns the stored receipt with duplicate true', result, {...t.submit.result, duplicate: true});
  let now = await t.snapshot();
  equal('Replay: it submits no second job, writes no audit row and keeps the version', [now.data.jobs.length, now.audit.length, now.revision], [before.data.jobs.length, before.audit.length, before.revision]);
  result = await t.agent.call(APP + 'jobs.submit', {...t.submit.args, seed: 1});
  check('Replay: the same request_id with changed input returns idempotency_conflict', result.status === 'idempotency_conflict' && result.applied === false, result);
  result = await t.agent.call(APP + 'preferences.update', {email_notices: true, expected_version: t.submit.args.expected_version, request_id: 'mcp-stale'});
  check('Replay: a write with a stale expected_version returns stale_version and names the current version', result.status === 'stale_version' && same(result.current_version, t.version), result);
  now = await t.snapshot();
  check('Replay: the conflict and the stale write changed no business data', same(now.data, before.data) && now.revision === before.revision);
  equal('Replay: the conflict and the stale write each have one deny row in the audit', now.audit.slice(before.audit.length).map(row => [row.input.request_id, row.decision, row.reason]),
    [[t.submit.request_id, 'deny', 'idempotency_conflict'], ['mcp-stale', 'deny', 'stale_version']]);
  const fourth = await t.refused('jobs.submit', {...SUBMIT, seed: 1});
  check('W2 control: a fourth active job returns too_many_active', fourth.status === 'too_many_active', fourth);
}

async function runs(t) {
  const id = t.submit.result.id;
  await t.tick(at('12-02 09:00'));
  equal('Time alone: the plan waits 30 minutes, so at 09:00 the job reads running from 08:00', [(await job(t, id)).job.state, (await job(t, id)).job.starts_at], ['running', at('12-02 08:00')]);
  await t.plan('ev-bl-225');
  await t.tick(at('12-02 18:00'));
  const done = await job(t, id), notices = (await t.get('notifications.list')).items.filter(n => n.object_id === id);
  equal('Time alone: after its 600 minutes, at 18:00, the job reads completed with its result, 40 charged and 0 reserved, and its job.ended notice is listed from then',
    [done.job.state, done.job.charged_hours, done.job.reserved_hours, done.result.metrics, notices.map(n => [n.kind, n.at])],
    ['completed', 40, 0, {accuracy: 0.716}, [['job.ended', at('12-02 18:00')]]]);
}

async function held(t) {
  await t.tick(at('12-02 19:40'));
  const before = await usage(t);
  t.held = await t.write('jobs.submit', {id: 'cfg-vit-s16-v2', seed: 0, partition_id: 'gpu-a', gpus: 1, time_limit_hours: 12, protocol_id: 'proto-subj-v2', hold: true});
  equal('Review request: a submission with hold: true is held with the reason submitted_held and reserves nothing; the usage summary is unchanged',
    [t.held.result.state, t.held.result.hold_reason, t.held.result.reserved_hours, await usage(t)], ['held', 'submitted_held', 0, before]);
  // Mei's job-0131 has used 86 GPU-hours, so the project has 2 left: the release reruns the full check and stops at the allocation step.
  const refusal = await t.refused('jobs.release', {id: t.held.result.id});
  check('Review request: jobs.release reruns the full check: with 2 GPU-hours left, the release of the 12-hour job returns over_allocation', refusal.status === 'over_allocation', refusal);
  await t.write('jobs.cancel', {id: t.held.result.id});
  await t.plan('ev-bl-212');
  const notice = (await t.snapshot()).data.notifications.find(n => n.event_id === 'ev-bl-212');
  equal('ev-bl-212: the 22:00 script job runs the same check; 48 do not fit what the project has left, so no job is added and one notice names over_allocation',
    [notice.kind, notice.details.error, (await t.snapshot()).data.jobs.some(j => j.event_id === 'ev-bl-212')], ['job.submission_rejected', 'over_allocation', false]);
}

async function allocationCut(t) {
  const pair = await queued(t);
  await t.plan('ev-bl-201');
  const state = await t.snapshot(), notice = state.data.notifications.find(n => n.event_id === 'ev-bl-201');
  const expected = structuredClone(WIRE);
  expected.id = notice.id;
  expected.data.content.body.text = expected.data.content.body.text.replace(' Two of your', ' Your share is now 45 GPU-hours, from 150. Two of your');
  equal('ev-bl-201 writes the allocation notice: the stored wire message is the plan\'s example, with the share sentence of the same event', notice.email, expected);
  const heldJobs = (await t.get('jobs.list', {owner_person_id: 'person-nadia', state: 'held'})).items;
  equal('W2: the cut to 120 holds the two queued jobs with the reason allocation and the flag unfunded', heldJobs.map(j => [j.id, j.hold_reason, j.flags]), pair.map(id => [id, 'allocation', ['unfunded']]));
  equal('The event wrote its own row, one effect row for each held job and one for the notice',
    state.data.activity.filter(a => a.event_id === 'ev-bl-201').map(a => [a.action, a.effect]), [['allocation.changed', false], ['job.held', true], ['job.held', true], ['notification.written', true]]);
  const result = await t.refused('jobs.release', {id: pair[0]});
  check('W2: jobs.release of a held job while the project is overdrawn returns over_allocation', result.status === 'over_allocation', result);
  await t.plan('ev-bl-220');
}

async function protocols(t) {
  await t.plan('ev-bl-230');
  equal('W3: ev-bl-230 adds proto-subj-v3 as proposed, and Nadia is asked to sign it', [(await t.get('protocols.get', {id: 'proto-subj-v3'})).protocol.state,
    (await t.get('notifications.list')).items.some(n => n.kind === 'protocol.proposed' && n.object_id === 'proto-subj-v3')], ['proposed', true]);
  await t.tick(at('12-03 14:00'));
  const declined = await t.write('protocols.respond', {id: 'proto-subj-v3', answer: 'decline', note: 'The test subjects stay unseen.'});
  const proposed = await t.write('protocols.propose', {...SPEC, seeds: [0, 1, 2, 3, 4], rationale: 'Five seeds for the paper.'});
  const {id, state, respond_by, missing_signers} = proposed.result;
  equal('W3: the decline declines v3; seeds 0 to 4 make proto-subj-v4, proposed with respond_by five days later', [declined.result.state, {id, state, respond_by, missing_signers}],
    ['declined', {id: 'proto-subj-v4', state: 'proposed', respond_by: at('12-08 14:00'), missing_signers: ['person-okafor']}]);
  await t.event('job.recorded', at('12-03 20:00'), {job_id: 'job-0140', owner_person_id: 'person-farid', config_id: 'cfg-vit-s16-v2', seed: 1, partition_id: 'gpu-h', gpus: 4,
    time_limit_hours: 12, starts_at: at('12-03 20:10'), ends_at: '2026-12-04T06:00:00-05:00', end_kind: 'completed', protocol_id: 'proto-subj-v2', metrics: {accuracy: 0.69}});
  await t.plan('ev-bl-215');
  equal('ev-bl-215 interrupts job-0140, and it leaves no result', [(await job(t, 'job-0140')).job.state, (await job(t, 'job-0140')).result], ['interrupted', null]);
  await t.plan('ev-bl-231');
  equal('W3: ev-bl-231 is the last required signature: v4 reads signed and v2 superseded', [(await t.get('protocols.get', {id: 'proto-subj-v4'})).protocol.state,
    (await t.get('protocols.get', {id: 'proto-subj-v2'})).protocol.state], ['signed', 'superseded']);
  await t.event('protocol.proposed', at('12-04 11:00'), {protocol_id: 'proto-subj-v5', line: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects',
    metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2, 3, 4, 5], proposed_by: 'person-tomas'});
  await t.plan('ev-bl-232');
  equal('ev-bl-232 withdraws proto-subj-v5', (await t.get('protocols.get', {id: 'proto-subj-v5'})).protocol.state, 'withdrawn');
}

async function tables(t) {
  await t.tick(at('12-04 13:00'));
  const mine = (await t.get('jobs.list', {owner_person_id: 'person-nadia', config_id: 'cfg-vit-s16-v2', start: '2026-12-01', end: '2026-12-01'})).items.map(j => j.id);
  t.table = await t.write('tables.create', {id: 'proto-subj-v2', title: 'Main results'});
  await t.write('tables.update', {id: t.table.result.id, rows: [{name: 'MAE-B/16 v2', result_ids: ['job-0101', 'job-0102', 'job-0103']}, {name: 'ViT-S/16 v2', result_ids: mine}]});
  const frozen = await t.write('tables.freeze', {id: t.table.result.id}), got = (await t.get('tables.get', {id: t.table.result.id})).table;
  equal('W4: the frozen table under the superseded v2 reads count 3, mean 0.7120 and sd 0.0070 for the first row, and its CSV has the same row',
    [frozen.result.state, got.manifest.rows[0].metrics.accuracy, got.csv.split('\n')[1], got.flags],
    ['frozen', {count: 3, mean: 0.712, sd: 0.007}, 'MAE-B/16 v2,cfg-mae-b16-v2,0 1 2,job-0101 job-0102 job-0103,3,0.7120,0.0070', ['protocol_superseded']]);
  await t.plan('ev-bl-240');
  const after = (await t.get('tables.get', {id: t.table.result.id})).table;
  equal('W4: ev-bl-240 invalidates job-0102: the frozen manifest is unchanged and the table reads cites_invalidated', [same(after.manifest, got.manifest), after.flags],
    [true, ['cites_invalidated', 'protocol_superseded']]);
}

async function evaluatorRecords(t) {
  const before = await t.snapshot(), reads = readCalls().map(([name, args]) => name === 'tables.get' ? [name, {id: t.table.result.id}] : [name, args]);
  for (const [name, args] of reads) await t.get(name, args);
  const now = await t.snapshot(), rows = now.audit.slice(before.audit.length), row = name => rows.find(r => r.tool === APP + name);
  check('The business data in env.snapshot is byte-identical before and after all 15 reads', same(now.data, before.data) && now.revision === before.revision);
  equal('Each of the 15 reads has one allow row in the audit, with no state change', rows.map(r => [r.tool, r.actor, r.decision, r.state_changed]),
    reads.map(([name]) => [APP + name, 'agent', 'allow', false]));
  equal('The audit row of a read carries input.id', [row('configs.get').input, row('jobs.get').input, row('protocols.get').input, row('jobs.estimate').input.id],
    [{id: 'cfg-mae-b16-v3'}, {id: 'job-0101'}, {id: 'proto-subj-v2'}, 'cfg-mae-b16-v3']);
  equal('The audit row of a windowed read carries input.start and input.end', [row('jobs.list').input, row('results.list').input, row('notifications.list').input],
    [{start: '2026-12-01', end: '2026-12-02'}, {start: '2026-11-01', end: '2026-12-31'}, {start: '2026-11-01', end: '2026-12-31'}]);
  const rowOf = call => now.audit.find(r => r.input.request_id === call.request_id);
  const shown = call => [rowOf(call).tool, rowOf(call).decision, rowOf(call).input, rowOf(call).result];
  equal('The audit row of a write carries input.id, the request_id, the observed version and the ID of the object it wrote', [shown(t.submit), shown(t.table)], [
    [APP + 'jobs.submit', 'allow', {id: 'cfg-mae-b16-v3', request_id: t.submit.request_id, expected_version: t.submit.args.expected_version}, {status: 'committed', object_id: t.submit.result.id}],
    [APP + 'tables.create', 'allow', {id: 'proto-subj-v2', request_id: t.table.request_id, expected_version: t.table.args.expected_version}, {status: 'committed', object_id: t.table.result.id}]]);
  equal('The audit row of each applied event carries its event_id', now.audit.filter(r => r.tool === 'env.apply_event' && r.decision === 'allow').map(r => r.input.event_id),
    t.events.map(e => e.event_id));
  equal('The join scope: the snapshot gives run_id, app_id, epoch and revision next to the activity rows',
    [now.run_id, now.app_id, {epoch: now.epoch, revision: now.revision}, Array.isArray(now.data.activity)], [RUN, 'benchline', t.version, true]);
  const added = now.data.activity.slice(t.seed.activity.length), main = added.filter(a => !a.effect);
  check('Every added activity row has seq, virtual time, actor, action, object ID and the request_id or event_id behind it', added.every(a => Number.isInteger(a.seq) &&
    typeof a.at === 'string' && typeof a.object_id === 'string' && (a.actor === 'agent' ? a.request_id && !a.event_id : a.actor === 'event' && a.event_id && !a.request_id)));
  check('Effect rows are marked effect true, and the rows of writes and events effect false', added.every(a => a.effect === EFFECTS.includes(a.action)) && added.some(a => a.effect));
  check('Every committed write has one activity row with its request_id (' + t.writes.length + ' writes)',
    t.writes.every(w => main.filter(a => a.request_id === w.request_id && a.actor === 'agent' && a.action === w.name).length === 1));
  check('Every applied event has one activity row with its event_id (' + t.events.length + ' events)', t.events.every(e => main.filter(a => a.event_id === e.event_id && a.actor === 'event').length === 1));
  equal('There is no other activity row, apart from the rows of effects', main.length, t.writes.length + t.events.length);
  check('Each new notification has one effect row', now.data.notifications.slice(t.seed.notifications.length).every(n =>
    added.filter(a => a.action === 'notification.written' && a.object_id === n.id && a.effect).length === 1));
  check('A refused call has a deny row in the audit and no activity row (' + t.refusals.length + ' refusals)', t.refusals.every(call =>
    now.audit.filter(r => r.input.request_id === call.request_id && r.decision === 'deny' && r.reason === call.result.status).length === 1 &&
    !now.data.activity.some(a => a.request_id === call.request_id)));
  equal('The audit has one row for each env.advance_time that is not a replay',
    now.audit.filter(r => r.tool === 'env.advance_time' && r.decision === 'allow').map(r => r.clock.to), t.advances.map(move => move.args.virtual_now));
}

async function clockReplay(t) {
  const last = t.advances[t.advances.length - 1], before = await t.snapshot();
  equal('Replay: a replayed env.advance_time returns the stored receipt with duplicate true', await t.infra.call('env.advance_time', last.args), {...last.result, duplicate: true});
  const now = await t.snapshot();
  equal('Replay: the replayed env.advance_time adds no audit row and moves nothing', [now.audit.length, now.virtual_now, now.revision], [before.audit.length, before.virtual_now, before.revision]);
}

async function reset(t) {
  const result = await t.infra.call('env.reset', {expected_version: t.version}), before = t.version;
  check('env.reset returns ready for this App instance only', result.status === 'ready' && result.reset_scope === 'benchline', result);
  const now = await t.snapshot();
  t.version = result.version;
  equal('Reset restores the loaded seed', now.data, t.seed);
  equal('Reset restores the time loaded with the seed', [now.virtual_now, (await t.get('preferences.get')).now], [START, START]);
  equal('Reset clears the audit and the receipts: only the row of the reset itself is left', [now.audit.map(r => r.tool), Object.keys(now.receipts)], [['env.reset'], []]);
  equal('Reset advances the epoch', [now.epoch, now.revision], [before.epoch + 1, 0]);
  const again = {result: await t.refused('jobs.release', {id: (await queued(t))[0]})};
  check('Back at the loaded time, the two jobs of cfg-mae-b16-v3 read queued again, not held, so jobs.release returns invalid_state', /invalid_state/.test(again.result.status), again.result);
}

async function secondSeed(t) {
  const loaded = await t.infra.call('env.load_seed', {expected_version: t.version, request_id: 'second-seed', data: t.seed, virtual_now: '2026-12-02T15:30:00Z'});
  check('A second seed with another virtual_now is loaded in the same run', loaded.status === 'ready', loaded);
  t.version = loaded.version;
  equal('A start time spelled in UTC is read with the -05:00 offset of the project', (await t.get('preferences.get')).now, at('12-02 10:30'));
  await t.tick(at('12-03 09:00'));
  const result = await t.infra.call('env.reset', {expected_version: t.version}), now = await t.snapshot();
  equal('Reset goes back to the virtual_now of the seed loaded last, not to the first seed or the package clock',
    [result.status, now.virtual_now, (await t.get('preferences.get')).now, same(now.data, t.seed)], ['ready', '2026-12-02T15:30:00Z', at('12-02 10:30'), true]);
}

async function otherRun(t) {
  const now = await t.snapshot(t.peer), clock = JSON.parse(fs.readFileSync(path.join(t.copy, 'fixtures/clock.json'), 'utf8')).initial_time;
  const fixture = JSON.parse(fs.readFileSync(path.join(t.copy, read('app.json').fixtures.seed), 'utf8'));
  check('The second run other-run is not affected: its whole state is byte-identical', same(now, t.peerBefore));
  equal('The second run still holds the package fixture at the package clock, at its first version, with an empty audit',
    [same(now.data, fixture), now.virtual_now, now.epoch, now.revision, now.audit], [true, clock, 1, 0, []]);
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  const skip = reason => { console.log('SKIP: ' + reason); process.exitCode = SKIPPED; };
  if (!root) return skip('the real MCP checks need the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
  const runtime = path.resolve(root);
  if (!fs.existsSync(path.join(runtime, 'prepare.cjs')) || !fs.existsSync(path.join(runtime, 'client.cjs'))) return skip('no public runtime at ' + runtime + '.');
  const prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const report = {schema: 'benchline.mcp-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version,
    app_version: read('app.json').version, node: process.version, checks, passed: false};
  try {
    const t = await connect(runtime, prepared, clients);
    // The parts run in the order of the virtual time: 2 to 6 December 2026, then the reset and a second seed.
    const parts = [loadTaskSeed, discovery, failedCalls, submit, labmateJob, refusedEvents, runs, held, allocationCut, protocols, tables, evaluatorRecords, clockReplay,
      reset, secondSeed, otherRun];
    for (const part of parts) await part(t);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' of ' + checks.length + ' Benchline real MCP checks passed.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    console.log('FAIL: ' + checks.filter(c => c.status === 'passed').length + ' of ' + checks.length + ' Benchline real MCP checks passed.');
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    prepared.cleanup();
  }
  if (opts.report) {
    fs.mkdirSync(path.dirname(path.resolve(opts.report)), {recursive: true});
    fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error('FAIL: ' + error.message); process.exitCode = 1; });
