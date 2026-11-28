'use strict';
// Business tests T01 to T23 of the approved plan (section 4, "Acceptance plan").
// A test name starts with its plan ID and its workflow. A letter after the ID marks one more test for that ID.
// PKG tests check the package itself. No test reads a file outside the package.
// In a copy of the package alone exactly three tests are skipped: T19c, T20 and T23f. They need the real runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {builtinModules} = require('node:module');
const {spawnSync} = require('node:child_process');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const {createSender} = require('../infra/sender.cjs');
const {sha256, canonical} = require('../src/sha256.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const SEED = require('../examples/task-data/seed.json');

const ROOT = path.resolve(__dirname, '..');
const eventSchema = compile(require('../schemas/events.schema.json'), path.join(ROOT, 'schemas'));
const wireSchema = compile(require('../schemas/router-message.schema.json'), path.join(ROOT, 'schemas'));
const READS = ['project.get', 'usage.summary', 'configs.list', 'configs.get', 'jobs.list', 'jobs.get', 'jobs.estimate', 'results.list', 'results.compare',
  'protocols.list', 'protocols.get', 'tables.list', 'tables.get', 'notifications.list', 'preferences.get'];
const WRITES = ['jobs.submit', 'jobs.hold', 'jobs.release', 'jobs.cancel', 'results.update', 'protocols.propose', 'protocols.respond', 'protocols.withdraw',
  'tables.create', 'tables.update', 'tables.freeze', 'tables.revise', 'tables.discard', 'preferences.update'];
const EVENTS = ['allocation.changed', 'job.recorded', 'job.script_submitted', 'job.interrupted', 'plan.set', 'config.registered', 'protocol.proposed',
  'protocol.answered', 'protocol.withdrawn', 'result.invalidated'];
// The 23 App errors of section 2, in the order of the table. When two fit one call, the first one wins.
const ERRORS = ['not_found', 'not_yours', 'not_a_signer', 'invalid_state', 'invalid_window', 'invalid_timezone', 'time_limit_too_long', 'protocol_mismatch',
  'too_many_active', 'over_allocation', 'over_share', 'already_proposed', 'no_change', 'already_answered', 'not_completed', 'reason_required', 'mixed_protocols',
  'duplicate_result', 'empty_table', 'protocol_not_signed', 'incomplete_seeds', 'cites_excluded', 'cites_invalidated'];
const NOTICE_KINDS = ['allocation.changed', 'job.ended', 'job.interrupted', 'job.submission_rejected', 'protocol.proposed', 'protocol.updated', 'result.invalidated'];

// The task seed of examples/task-data, read at its clock: Wednesday 2 December 2026 at 07:00 in New York.
const NOW = '2026-12-02T07:00:00-05:00';
const OWNER = 'person-nadia', ACCOUNT = 'benchline-nadia';
// An instant in New York in December 2026, where the UTC offset is -05:00.
const ny = (day, time = '09:00:00') => '2026-12-' + day + 'T' + time + '-05:00';
const edit = (value, change) => { const next = structuredClone(value); change(next); return next; };
const start = (options = {}) => fixture({seed: SEED, now: NOW, ...options});
const withPolicy = change => edit(SEED, data => change(data.project.policy, data));
const SCHEMA = 'Input schema', EVENT_SCHEMA = 'Event schema';
// A refused call or event gives the error code of the plan and leaves the data as it was. `text` is a part of the message of the rule that refuses it.
// SCHEMA stands for a call that breaks its input schema: Core answers `invalid_arguments` before the App runs. EVENT_SCHEMA is the same for an event.
// The data includes the activity rows, and each commit writes one (T20c), so an unchanged log also means that Core's version did not move.
function unchanged(f, fn, code, label = code, text = '') {
  const before = f.data, version = commits(before);
  assert.throws(fn, error => {
    const got = error.message.startsWith(SCHEMA) ? SCHEMA : error.message.startsWith(EVENT_SCHEMA) ? EVENT_SCHEMA : error.code;
    assert.equal(got, code, label + ': ' + error.message);
    assert.ok(error.message.includes(text), label + ': ' + error.message);
    return true;
  }, label);
  assert.deepEqual(f.data, before, label);
  assert.equal(commits(f.data), version, label);
}
const commits = data => data.activity.filter(row => !row.effect).length;

// Events of labmates, the lab head and the cluster.
let counter = 0;
const event = (name, at, payload, event_id = 'ev-t-' + (++counter)) => ({event_id, at, operation: 'benchline.' + name, payload});
const script = (at, more = {}) => event('job.script_submitted', at, {script: 'birch-ablations.sh', config_id: 'cfg-birch-abl-v1', seed: 0, partition_id: 'gpu-h', gpus: 2,
  time_limit_hours: 12, protocol_id: null, hold: false, ...more});
const recorded = (at, job_id, more = {}) => event('job.recorded', at, {job_id, owner_person_id: 'person-mei', config_id: 'cfg-vit-s16-v2', seed: 0, partition_id: 'gpu-h',
  gpus: 4, time_limit_hours: 12, starts_at: at, ends_at: at, end_kind: 'completed', protocol_id: 'proto-subj-v2', metrics: {accuracy: 0.7}, ...more});
const proposed = (at, protocol_id, more = {}) => event('protocol.proposed', at, {protocol_id, line: 'subject-eval', dataset_version: 'eeg-subjects-2026.2',
  eval_split: 'test-trials', metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2], proposed_by: 'person-tomas', rationale: 'A trial-level split needs a third of the compute.', ...more});
const answered = (at, protocol_id, person_id, answer = 'sign', note) => event('protocol.answered', at, {protocol_id, person_id, answer, ...(note ? {note} : {})});
const planSet = (at, config_id, more = {}) => event('plan.set', at, {config_id, queue_wait_minutes: 30, run_minutes: 600, outcome: 'completed', metrics: {accuracy: 0.7}, ...more});
const SUBMIT = {id: 'cfg-mae-b16-v3', seed: 2, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12, protocol_id: 'proto-subj-v2'};
const mine = (f, state) => f.call('jobs.list', {owner_person_id: OWNER, ...(state ? {state} : {})}).items;
const usage = f => f.call('usage.summary').usage;
const share = f => usage(f).shares.find(s => s.person_id === OWNER);
const queuedPair = f => mine(f, 'queued').map(j => j.id);

// The examples of the plan, one on each line of a helper file. `dev/check-plan-examples.cjs` compares them with the plan, byte for byte.
const verbatim = file => fs.readFileSync(path.join(__dirname, file), 'utf8').split('\n').filter(line => line.startsWith('{')).map(line => line.replace(/,$/, ''));
const PLAN_EVENTS = verbatim('proposal-events.json'), PLAN_WIRE = verbatim('proposal-wire-message.json')[0];
const PLAN = Object.fromEntries(PLAN_EVENTS.map(line => JSON.parse(line)).map(e => [e.event_id, e]));

test('T01 [W1] usage: with a December allocation of 400 GPU-hours, 212 used and 60 reserved, 128 remain; Nadia has 36 used and 60 reserved, so 54 are left of her share of 150', () => {
  const f = start(), u = usage(f);
  assert.deepEqual([u.allocation_hours, u.used, u.reserved, u.remaining, u.overdrawn_hours], [400, 212, 60, 128, 0]);
  assert.equal(u.period.period_id, 'alloc-2026-12');
  const s = share(f);
  assert.deepEqual([s.share_hours, s.used, s.reserved, s.remaining], [150, 36, 60, 54]);
  // A job of an earlier period is history: the November jobs are charged and do not count against December.
  const november = f.call('jobs.list', {start: '2026-11-01', end: '2026-11-30'}).items;
  assert.ok(november.length > 5 && november.every(j => j.period_id === 'alloc-2026-11'));
  assert.ok(november.some(j => j.charged_hours > 0));
  // A person with no share has share_hours null and no share row: only the project allocation applies.
  assert.equal(f.call('project.get').people.find(p => p.person_id === 'person-farid').share_hours, null);
  assert.ok(!u.shares.some(x => x.person_id === 'person-farid'));
});

test('T02 [W1] estimate: 2 GPUs for 12 hours on gpu-h reserve 48, leaving 80 and 6; 24 hours reserve 96 and read over_share with soft shares; 4 GPUs for 24 hours fail over_allocation', () => {
  const f = start(), estimate = args => f.call('jobs.estimate', {...SUBMIT, ...args}).estimate;
  assert.deepEqual(estimate({}), {allowed: true, failures: [], reserve_hours: 48, project_left: 80, share_left: 6, flags: []});
  assert.deepEqual(estimate({time_limit_hours: 24, protocol_id: null}), {allowed: true, failures: [], reserve_hours: 96, project_left: 32, share_left: -42, flags: ['over_share']});
  assert.deepEqual(estimate({gpus: 4, time_limit_hours: 24, protocol_id: null}),
    {allowed: false, failures: ['over_allocation'], reserve_hours: 192, project_left: -64, share_left: -138, flags: ['over_share']});
  // With hard shares the share is a step of the check. Every failing step after not_found is listed.
  const hard = fixture({seed: withPolicy(p => { p.hard_shares = true; }), now: NOW});
  assert.deepEqual(hard.call('jobs.estimate', {...SUBMIT, seed: 7, gpus: 4, time_limit_hours: 30}).estimate.failures,
    ['time_limit_too_long', 'protocol_mismatch', 'over_allocation', 'over_share']);
  // With hold: true only the first four steps run, and nothing is reserved.
  assert.deepEqual(hard.call('jobs.estimate', {...SUBMIT, gpus: 4, time_limit_hours: 24, hold: true}).estimate,
    {allowed: true, failures: [], reserve_hours: 0, project_left: 128, share_left: 54, flags: []});
  // An estimate under an unsigned protocol version is allowed, and it carries the flag.
  f.event(proposed(ny('02', '07:30:00'), 'proto-subj-v3', {eval_split: 'test-subjects', dataset_version: 'eeg-subjects-2026.2', seeds: [0, 1, 2, 3]}));
  assert.deepEqual(estimate({protocol_id: 'proto-subj-v3'}).flags, ['protocol_unsigned']);
  unchanged(f, () => f.call('jobs.estimate', {...SUBMIT, id: 'cfg-none'}), 'not_found');
  unchanged(f, () => f.call('jobs.estimate', {...SUBMIT, partition_id: 'gpu-z'}), 'not_found');
  unchanged(f, () => f.call('jobs.estimate', {...SUBMIT, protocol_id: 'proto-none'}), 'not_found');
});

test('T03 [W1] reads: every read returns now with the project\'s UTC offset, the lists filter and sort, and the business data stays byte-identical after every read', () => {
  const f = start(), before = JSON.stringify(f.data);
  const p = f.call('project.get');
  assert.equal(p.project.policy.max_active_jobs, 3);
  assert.deepEqual(p.partitions.map(x => [x.id, x.rate, x.max_hours]), [['gpu-h', 2, 24], ['gpu-a', 1, 48], ['cpu', 0, 72]]);
  assert.equal(p.allocation_changes.length, 1);
  assert.equal(f.call('configs.list').items.length, 12);
  assert.deepEqual(f.call('configs.list', {family: 'atlas'}).items.map(c => c.id), ['cfg-atlas-v1', 'cfg-atlas-v2', 'cfg-atlas-v3']);
  assert.equal(f.call('configs.get', {id: 'cfg-mae-b16-v3'}).config.eval_split, 'test-subjects');
  const all = f.call('jobs.list').items;
  assert.ok(all.every((j, i) => i === 0 || Date.parse(all[i - 1].submitted_at) <= Date.parse(j.submitted_at)));
  assert.deepEqual(f.call('jobs.list', {start: '2026-12-01', end: '2026-12-01', owner_person_id: 'person-mei'}).items.map(j => j.id), ['job-0101', 'job-0102', 'job-0103']);
  assert.deepEqual(f.call('jobs.list', {state: 'queued'}).items.map(j => j.config_id), ['cfg-mae-b16-v3', 'cfg-mae-b16-v3']);
  assert.equal(f.call('jobs.list', {config_id: 'cfg-vit-s16-v1'}).items.length, 2);
  assert.equal(f.call('jobs.list', {protocol_id: 'proto-subj-v1'}).items.length, 2);
  const done = f.call('jobs.get', {id: 'job-0102'});
  assert.deepEqual([done.job.state, done.result.metrics.accuracy, done.result.state], ['completed', 0.705, 'candidate']);
  assert.equal(f.call('results.list', {protocol_id: 'proto-subj-v2', start: '2026-12-01'}).items.length, 7);
  assert.deepEqual(f.call('protocols.list', {line: 'subject-eval'}).items.map(x => [x.id, x.state]), [['proto-subj-v1', 'superseded'], ['proto-subj-v2', 'signed']]);
  assert.deepEqual(f.call('protocols.get', {id: 'proto-subj-v2'}).protocol.missing_signers, []);
  assert.deepEqual(f.call('tables.list').items, []);
  assert.ok(f.call('notifications.list').items.length > 5);
  assert.deepEqual(f.call('preferences.get').preferences, {timezone: 'America/New_York', email_notices: true, job_end_notices: true});
  for (const name of READS.filter(n => !['jobs.estimate', 'results.compare', 'configs.get', 'jobs.get', 'protocols.get', 'tables.get'].includes(n))) {
    assert.equal(f.call(name).now, NOW, name);
  }
  assert.equal(JSON.stringify(f.data), before);
  unchanged(f, () => f.call('jobs.list', {start: '2026-12-02', end: '2026-12-01'}), 'invalid_window');
  unchanged(f, () => f.call('notifications.list', {start: '2026-11-31'}), 'invalid_arguments');
  for (const name of ['configs.get', 'jobs.get', 'protocols.get', 'tables.get']) unchanged(f, () => f.call(name, {id: 'nothing'}), 'not_found', name);
  // Reads work at Core's default clock of 1970, before any record.
  const early = fixture({seed: SEED, now: '1970-01-01T00:00:00.000Z'});
  assert.equal(early.call('usage.summary').now, '1969-12-31T19:00:00-05:00');
  assert.equal(early.call('jobs.list').items.every(j => j.state === 'queued' || j.state === 'held'), true);
});

test('T04 [W1] compare: a result under proto-subj-v2 and one under proto-subj-v1 are not comparable and differ in eval_split; two under one version are comparable', () => {
  const f = start(), v1 = f.call('jobs.list', {protocol_id: 'proto-subj-v1'}).items[0].id;
  const out = f.call('results.compare', {ids: ['job-0101', v1]});
  assert.equal(out.comparable, false);
  assert.deepEqual(out.differences.map(d => d.field), ['protocol_id', 'eval_split']);
  assert.deepEqual(out.differences[1].values, {'job-0101': 'test-subjects', [v1]: 'test-sessions'});
  const same = f.call('results.compare', {ids: ['job-0101', 'job-0102', 'job-0103']});
  assert.deepEqual([same.comparable, same.differences], [true, []]);
  // A result under no protocol is never comparable.
  const birch = f.call('jobs.list', {config_id: 'cfg-birch-abl-v1', state: 'completed'}).items.map(j => j.id), none = birch[0];
  assert.equal(f.call('results.compare', {ids: ['job-0101', none]}).comparable, false);
  assert.deepEqual(f.call('results.compare', {ids: birch.slice(0, 2)}).comparable, false, 'two results under no protocol are not comparable either');
  unchanged(f, () => f.call('results.compare', {ids: ['job-0101']}), SCHEMA);
  unchanged(f, () => f.call('results.compare', {ids: ['job-0101', queuedPair(f)[0]]}), 'not_completed');
});

test('T05 [W1] reads never return a run plan, a wait, a run time or an outcome that is not yet due', () => {
  const f = start();
  f.call('jobs.submit', SUBMIT);
  const text = JSON.stringify(READS.filter(n => !['jobs.estimate', 'results.compare', 'configs.get', 'jobs.get', 'protocols.get', 'tables.get'].includes(n)).map(n => f.call(n)));
  for (const word of ['queue_wait_minutes', 'run_minutes', 'plan_id', 'run_plans', 'end_kind', '0.716']) assert.ok(!text.includes(word), word);
  const job = mine(f, 'queued').find(j => j.seed === 2);
  const got = f.call('jobs.get', {id: job.id});
  assert.deepEqual([got.job.starts_at, got.job.ends_at, got.result], [null, null, null]);
  assert.ok(!JSON.stringify(got).includes('0.716'));
  // The job.ended notice is written at the submission and listed only from the end of the job.
  assert.ok(!f.call('notifications.list').items.some(n => n.object_id === job.id));
});

test('T06 [W2] submit: at 09:00 a job of cfg-mae-b16-v3, seed 2, 2 GPUs for 12 hours on gpu-h under proto-subj-v2 is queued and reserves 48; with hold: true it is held and reserves nothing', () => {
  const f = start();
  f.advance(ny('02'));
  const out = f.call('jobs.submit', SUBMIT);
  assert.deepEqual([out.state, out.reserved_hours, out.hold_reason, out.config_id], ['queued', 48, null, 'cfg-mae-b16-v3']);
  assert.equal(out.id, 'job-a0015');
  assert.deepEqual([usage(f).reserved, share(f).remaining], [108, 6]);
  const g = start();
  g.advance(ny('02'));
  const before = usage(g);
  const held = g.call('jobs.submit', {...SUBMIT, hold: true});
  assert.deepEqual([held.state, held.hold_reason, held.reserved_hours], ['held', 'submitted_held', 0]);
  assert.deepEqual(usage(g), before);
  const job = g.call('jobs.get', {id: held.id}).job;
  assert.deepEqual([job.state, job.hold_reason, job.reserved_hours, job.starts_at], ['held', 'submitted_held', 0, null]);
  // jobs.release runs the full check, and the held job does not count against the job count.
  const released = g.call('jobs.release', {id: held.id});
  assert.deepEqual([released.state, released.reserved_hours], ['queued', 48]);
  assert.equal(usage(g).reserved, 108);
});

test('T07 [W2] the clock: the plan waits 30 minutes and runs 600; at 09:30 the job is running, and at 19:30 it is completed with its result, 40 charged and 8 returned', () => {
  const f = start();
  f.advance(ny('02'));
  const {id} = f.call('jobs.submit', SUBMIT);
  f.advance(ny('02', '09:29:59'));
  assert.equal(f.call('jobs.get', {id}).job.state, 'queued');
  f.advance(ny('02', '09:30:00'));
  let job = f.call('jobs.get', {id}).job;
  assert.deepEqual([job.state, job.starts_at, job.ends_at, job.reserved_hours], ['running', ny('02', '09:30:00'), null, 48]);
  f.advance(ny('02', '19:30:00'));
  const got = f.call('jobs.get', {id});
  job = got.job;
  assert.deepEqual([job.state, job.ends_at, job.charged_hours, job.reserved_hours], ['completed', ny('02', '19:30:00'), 40, 0]);
  assert.deepEqual(got.result.metrics, {accuracy: 0.716});
  assert.deepEqual([share(f).used, share(f).reserved], [76, 60]);
  assert.equal(usage(f).remaining, 128 - 40);
});

test('T08 [W2] controls: a 30-hour limit is time_limit_too_long, seed 7 is protocol_mismatch, a fourth job is too_many_active, and a 15-hour run under a 12-hour limit is timed_out with 48 charged', () => {
  const f = start();
  f.advance(ny('02'));
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, time_limit_hours: 30}), 'time_limit_too_long', 'time limit', 'longest job time of gpu-h');
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, seed: 7}), 'protocol_mismatch');
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, id: 'cfg-vit-s16-v1'}), 'protocol_mismatch', 'a config of another split');
  f.call('jobs.submit', SUBMIT);
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, seed: 1}), 'too_many_active');
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, seed: 1, hold: true}), 'too_many_active', 'a held job counts too');
  // The check ignores the state of the protocol version: a job may run under a version that is not signed.
  const g = start();
  g.event(proposed(ny('02', '08:00:00'), 'proto-subj-v3', {eval_split: 'test-subjects'}));
  assert.equal(g.call('jobs.submit', {...SUBMIT, protocol_id: 'proto-subj-v3'}).state, 'queued');
  // The plan for seed 2 on gpu-h runs 900 minutes: under a 12-hour limit the job ends timed_out at 12 hours.
  const h = start();
  h.advance(ny('02'));
  const {id} = h.call('jobs.submit', {...SUBMIT, id: 'cfg-vit-s16-v2', seed: 2});
  h.advance(ny('02', '21:19:59'));
  assert.equal(h.call('jobs.get', {id}).job.state, 'running');
  h.advance(ny('02', '21:20:00'));
  const got = h.call('jobs.get', {id});
  assert.deepEqual([got.job.state, got.job.charged_hours, got.result, got.job.has_result], ['timed_out', 48, null, false]);
  // The seed-2 plan on gpu-a is more specific than none and is used on gpu-a; a plan that names the seed wins over one that names the partition only.
  const k = start();
  k.event(planSet(ny('02', '07:10:00'), 'cfg-vit-s16-v2', {partition_id: 'gpu-a', run_minutes: 60, metrics: {accuracy: 0.5}}));
  k.call('jobs.cancel', {id: mine(k, 'queued')[0].id});
  const a = k.call('jobs.submit', {...SUBMIT, id: 'cfg-vit-s16-v2', seed: 1, partition_id: 'gpu-a', gpus: 1});
  k.advance(ny('03', '07:30:00'));
  assert.equal(k.call('jobs.get', {id: a.id}).result.metrics.accuracy, 0.689);
});

test('T09 [W2] allocation cut: allocation.changed to 120 holds both queued jobs with the reason allocation; the summary reads 0 remaining and 92 overdrawn, and jobs.release returns over_allocation', () => {
  const f = start(), pair = queuedPair(f);
  f.event(event('allocation.changed', ny('02', '08:00:00'), {allocation_hours: 120, changed_by: 'person-okafor', reason: 'The department moved hours to the shared pool.'}));
  const held = mine(f, 'held');
  assert.deepEqual(held.map(j => [j.id, j.hold_reason, j.flags]), pair.map(id => [id, 'allocation', ['unfunded']]));
  const u = usage(f);
  assert.deepEqual([u.allocation_hours, u.used, u.reserved, u.remaining, u.overdrawn_hours], [120, 212, 0, 0, 92]);
  unchanged(f, () => f.call('jobs.release', {id: pair[0]}), 'over_allocation');
  // A later increase releases nothing. The agent releases the job when it fits.
  f.event(event('allocation.changed', ny('02', '09:00:00'), {allocation_hours: 300, changed_by: 'person-okafor'}));
  assert.equal(mine(f, 'held').length, 2);
  assert.equal(f.call('jobs.release', {id: pair[0]}).state, 'queued');
  // A lower share holds nothing. It limits only later submissions and releases.
  f.event(event('allocation.changed', ny('02', '09:30:00'), {shares: [{person_id: OWNER, share_hours: 40}], changed_by: 'person-okafor'}));
  assert.equal(mine(f, 'queued').length, 1);
  // Only the last submitted jobs are held, until the project is no longer overdrawn. Running jobs go on.
  const g = start();
  g.event(event('allocation.changed', ny('02', '08:00:00'), {allocation_hours: 250, changed_by: 'person-okafor'}));
  assert.deepEqual(mine(g, 'held').map(j => j.id), [pair[1]]);
  assert.deepEqual(mine(g, 'queued').map(j => j.id), [pair[0]]);
  assert.deepEqual(g.call('project.get').allocation_changes.map(c => [c.from_hours, c.to_hours]), [[380, 340], [400, 250]]);
});

test('T09b [W2] a free job: after the cut to 120 the project is overdrawn, but a job on the rate-0 cpu partition reserves nothing, so it is allowed, queued and never held', () => {
  const cpu = {...SUBMIT, partition_id: 'cpu', gpus: 1, time_limit_hours: 4};
  for (const hard of [false, true]) {
    const f = fixture({seed: withPolicy(p => { p.hard_shares = hard; p.max_active_jobs = 6; }), now: NOW});
    f.event(event('allocation.changed', ny('02', '08:00:00'), {allocation_hours: 120, shares: [{person_id: OWNER, share_hours: 20}], changed_by: 'person-okafor'}));
    assert.deepEqual([usage(f).overdrawn_hours > 0, share(f).overdrawn_hours > 0], [true, true], 'the project and the share are overdrawn');
    assert.deepEqual(f.call('jobs.estimate', cpu).estimate, {allowed: true, failures: [], reserve_hours: 0, project_left: 0, share_left: 0, flags: []}, 'hard ' + hard);
    unchanged(f, () => f.call('jobs.submit', {...cpu, partition_id: 'gpu-a'}), 'over_allocation', 'a paid job still fails');
    const out = f.call('jobs.submit', cpu);
    assert.deepEqual([out.state, out.reserved_hours, out.flags], ['queued', 0, []]);
    const held = f.call('jobs.submit', {...cpu, seed: 1, hold: true});
    assert.equal(f.call('jobs.release', {id: held.id}).state, 'queued', 'a held free job can be released');
    f.event(script(ny('02', '08:10:00'), {config_id: cpu.id, seed: 0, partition_id: 'cpu', gpus: 1, time_limit_hours: 4, protocol_id: 'proto-subj-v2'}));
    assert.deepEqual(rejected(f), [], 'a free script job is added');
    // A later cut holds only jobs that reserve hours: holding a free job frees nothing.
    f.event(event('allocation.changed', ny('02', '08:20:00'), {allocation_hours: 100, changed_by: 'person-okafor'}));
    assert.ok(mine(f, 'queued').filter(j => j.partition_id === 'cpu').length >= 2, 'the free jobs stay queued');
  }
});

test('T09c [W2] a held job counts toward max_active_jobs, and a cut that holds a planned job removes its pending job.ended notice', () => {
  // Two queued jobs and one held job are three active jobs: a fourth is too_many_active, queued or held.
  const f = start();
  f.call('jobs.submit', {...SUBMIT, hold: true});
  assert.deepEqual(mine(f).filter(j => ['queued', 'held', 'running'].includes(j.state)).map(j => j.state).sort(), ['held', 'queued', 'queued']);
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, seed: 1}), 'too_many_active', 'a fourth queued job');
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, seed: 1, hold: true}), 'too_many_active', 'a fourth held job');
  // A job with a run plan waits in the queue with its job.ended notice. The cut holds it and removes the notice before its release time.
  const g = start();
  g.call('jobs.cancel', {id: queuedPair(g)[0]});
  const {id} = g.call('jobs.submit', SUBMIT), notice = g.data.notifications.find(n => n.object_id === id && n.kind === 'job.ended');
  assert.deepEqual([notice.at, notice.removed_at], [ny('02', '17:30:00'), null]);
  g.event(event('allocation.changed', ny('02', '07:10:00'), {allocation_hours: 200, changed_by: 'person-okafor'}));
  assert.equal(g.call('jobs.get', {id}).job.hold_reason, 'allocation');
  assert.equal(g.data.notifications.find(n => n.id === notice.id).removed_at, ny('02', '07:10:00'));
  g.advance(ny('03'));
  assert.ok(!g.call('notifications.list').items.some(n => n.id === notice.id), 'a removed notice is never listed');
});

test('T09d [W2] running jobs go on during a cut: only queued jobs are held; and a job whose reservation equals what is left still fits, and a job one step larger does not', () => {
  const f = start();
  f.call('jobs.cancel', {id: queuedPair(f)[0]});
  f.advance(ny('02'));
  const {id} = f.call('jobs.submit', SUBMIT);
  f.advance(ny('02', '10:00:00'));
  assert.equal(f.call('jobs.get', {id}).job.state, 'running');
  f.event(event('allocation.changed', ny('02', '10:30:00'), {allocation_hours: 50, changed_by: 'person-okafor'}));
  const got = f.call('jobs.get', {id}).job;
  assert.deepEqual([got.state, got.hold_reason, got.reserved_hours], ['running', null, 48], 'the running job goes on and keeps its reservation');
  assert.equal(mine(f, 'held').length, 1, 'the queued job is held');
  // 128 GPU-hours are left: a job that reserves exactly 128 fits, one that reserves 128.5 does not.
  const g = start(), est = args => g.call('jobs.estimate', {...SUBMIT, protocol_id: null, ...args}).estimate;
  assert.deepEqual([est({gpus: 4, time_limit_hours: 16}).failures, est({gpus: 4, time_limit_hours: 16}).reserve_hours], [[], 128]);
  assert.deepEqual(est({gpus: 4, time_limit_hours: 16.01}).failures, ['over_allocation']);
});

test('T09e [W2] a cut holds only the researcher\'s jobs, and stops once used plus reserved is no more than the allocation (exact balance is not overdrawn)', () => {
  // Mei's job is queued and reserves 20 GPU-hours. It is the last one submitted, so a cut that held labmates' jobs would take it first.
  const withMei = () => {
    const f = start();
    f.event(recorded(ny('02', '07:00:00'), 'job-0300', {gpus: 1, time_limit_hours: 10, starts_at: ny('02', '12:00:00'), ends_at: ny('02', '18:00:00')}));
    return f;
  };
  const mei = f => f.call('jobs.get', {id: 'job-0300'}).job;
  const before = withMei(), pair = queuedPair(before);
  assert.deepEqual([mei(before).state, mei(before).reserved_hours, usage(before).used, usage(before).reserved], ['queued', 20, 212, 80]);
  // 212 used, 20 reserved by Mei and 30 by each of the pair: at 262 one hold is enough, at 261.99 both are held.
  for (const [hours, held, left] of [[262, [pair[1]], 0], [261.99, pair, 29.99]]) {
    const f = withMei();
    f.event(event('allocation.changed', ny('02', '07:10:00'), {allocation_hours: hours, changed_by: 'person-okafor'}));
    assert.deepEqual(mine(f, 'held').map(j => j.id), held, String(hours));
    assert.deepEqual([mei(f).state, mei(f).hold_reason, mei(f).reserved_hours], ['queued', null, 20], 'a labmate\'s queued job is not held');
    assert.deepEqual([usage(f).remaining, usage(f).overdrawn_hours], [left, 0]);
  }
});

test('T10 [W2] hold, release and cancel: only the account holder\'s jobs, in the right states; a running job is charged for the hours it ran and leaves no result', () => {
  const f = start(), [first, second] = queuedPair(f);
  const held = f.call('jobs.hold', {id: first});
  assert.deepEqual([held.state, held.hold_reason], ['held', 'agent']);
  assert.equal(usage(f).reserved, 30);
  unchanged(f, () => f.call('jobs.hold', {id: first}), 'invalid_state');
  unchanged(f, () => f.call('jobs.release', {id: second}), 'invalid_state');
  unchanged(f, () => f.call('jobs.hold', {id: 'job-0101'}), 'not_yours');
  unchanged(f, () => f.call('jobs.cancel', {id: 'job-0101'}), 'not_yours');
  unchanged(f, () => f.call('jobs.cancel', {id: mine(f, 'completed')[0].id}), 'invalid_state');
  assert.deepEqual(f.call('jobs.cancel', {id: first}), {id: first, state: 'cancelled', charged_hours: 0});
  assert.equal(f.call('jobs.cancel', {id: second}).charged_hours, 0);
  f.advance(ny('02'));
  const {id} = f.call('jobs.submit', SUBMIT);
  f.advance(ny('02', '12:00:00'));
  unchanged(f, () => f.call('jobs.hold', {id}), 'invalid_state', 'a running job cannot be held');
  const out = f.call('jobs.cancel', {id});
  assert.deepEqual([out.state, out.charged_hours], ['cancelled', 10]);
  const got = f.call('jobs.get', {id});
  assert.deepEqual([got.job.state, got.job.starts_at, got.job.ends_at, got.result], ['cancelled', ny('02', '09:30:00'), ny('02', '12:00:00'), null]);
  assert.deepEqual([share(f).used, share(f).reserved], [46, 0]);
  f.advance(ny('03'));
  assert.equal(f.call('jobs.get', {id}).job.state, 'cancelled');
});

test('T11 [W3] a labmate\'s proto-subj-v3 arrives as proposed and asks Nadia to sign; her decline makes it declined, and proto-subj-v2 is still signed', () => {
  const f = start();
  f.event(proposed(ny('03', '11:00:00'), 'proto-subj-v3'));
  const v3 = f.call('protocols.get', {id: 'proto-subj-v3'}).protocol;
  assert.deepEqual([v3.state, v3.version, v3.respond_by, v3.missing_signers], ['proposed', 3, ny('08', '11:00:00'), ['person-okafor', 'person-nadia']]);
  const notice = f.call('notifications.list').items.find(n => n.object_id === 'proto-subj-v3');
  assert.deepEqual([notice.kind, notice.title], ['protocol.proposed', 'Tomas Arce asks you to sign proto-subj-v3']);
  assert.ok(notice.text.includes('It changes the evaluation split from test-subjects to test-trials.'), notice.text);
  assert.ok(notice.text.includes('Sign or decline it by 8 December at 11:00. After that it expires.'), notice.text);
  const out = f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'decline', note: 'The test subjects stay unseen.'});
  assert.deepEqual([out.state, out.id], ['declined', 'proto-subj-v3']);
  assert.equal(f.call('protocols.get', {id: 'proto-subj-v2'}).protocol.state, 'signed');
  unchanged(f, () => f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'sign'}), 'invalid_state');
  // A job under a declined version reads protocol_unsigned.
  assert.deepEqual(f.call('jobs.estimate', {...SUBMIT, id: 'cfg-vit-s16-v2', protocol_id: 'proto-subj-v3', seed: 1}).estimate.failures, ['protocol_mismatch']);
});

test('T11b [W3] protocol_unsigned: a job and a result under a declined or an expired version read protocol_unsigned, and under a signed one they read no protocol flag', () => {
  const run = {...SUBMIT, id: 'cfg-vit-s16-v2', seed: 1, partition_id: 'gpu-a', gpus: 1, protocol_id: 'proto-subj-v3'};
  for (const outcome of ['declined', 'expired']) {
    const f = start();
    f.call('jobs.cancel', {id: queuedPair(f)[0]});
    f.event(proposed(ny('02', '07:10:00'), 'proto-subj-v3', {eval_split: 'test-subjects', seeds: [0, 1, 2, 3]}));
    const {id} = f.call('jobs.submit', run);
    if (outcome === 'declined') f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'decline'});
    f.advance(ny('08', '07:10:00'));
    assert.equal(f.call('protocols.get', {id: 'proto-subj-v3'}).protocol.state, outcome);
    const got = f.call('jobs.get', {id});
    assert.deepEqual([got.job.flags, got.result.flags], [['protocol_unsigned'], ['protocol_unsigned']], outcome);
  }
  assert.deepEqual(start().call('jobs.get', {id: 'job-0101'}).result.flags, []);
});

test('T12b [W3] when the researcher is not a required signer: her own proposal gets a protocol.updated notice for each answer, and a labmate\'s withdrawal writes none', () => {
  const f = fixture({seed: withPolicy(p => { p.required_signers = ['person-okafor', 'person-mei']; }), now: NOW});
  const kinds = () => f.data.notifications.slice(SEED.notifications.length).filter(n => n.kind === 'protocol.updated' || n.kind === 'protocol.proposed').map(n => [n.kind, n.object_id]);
  const own = f.call('protocols.propose', {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2, 3]});
  assert.deepEqual([own.state, own.missing_signers], ['proposed', ['person-okafor', 'person-mei']]);
  f.event(answered(ny('02', '08:00:00'), own.id, 'person-okafor'));
  f.event(answered(ny('02', '08:10:00'), own.id, 'person-mei'));
  assert.deepEqual(kinds(), [['protocol.updated', own.id], ['protocol.updated', own.id]], 'one notice for each answer to her own proposal');
  assert.equal(f.call('protocols.get', {id: own.id}).protocol.state, 'signed');
  f.event(proposed(ny('02', '09:00:00'), 'proto-subj-v9', {seeds: [0, 1]}));
  f.event(event('protocol.withdrawn', ny('02', '09:30:00'), {protocol_id: 'proto-subj-v9'}));
  assert.deepEqual(kinds().length, 2, 'no request to sign and no withdrawal notice for a person who is not a signer');
});

test('T12 [W3] propose: with signoff_window_days 5, seeds 0 to 4 make proto-subj-v4, proposed with Nadia\'s signature and respond_by five days later; the lab head\'s signature signs it and supersedes proto-subj-v2', () => {
  const f = start();
  f.event(proposed(ny('03', '11:00:00'), 'proto-subj-v3'));
  f.advance(ny('03', '14:00:00'));
  unchanged(f, () => f.call('protocols.propose', {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2, 3, 4]}), 'already_proposed');
  f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'decline'});
  const spec = {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: [{name: 'accuracy', direction: 'higher'}]};
  unchanged(f, () => f.call('protocols.propose', {...spec, seeds: [2, 0, 1]}), 'no_change', 'the signed version, in another order');
  const out = f.call('protocols.propose', {...spec, seeds: [0, 1, 2, 3, 4], rationale: 'Five seeds for the paper.'});
  assert.deepEqual(out, {id: 'proto-subj-v4', state: 'proposed', respond_by: ny('08', '14:00:00'), missing_signers: ['person-okafor']});
  const v4 = f.call('protocols.get', {id: 'proto-subj-v4'}).protocol;
  assert.deepEqual(v4.signoffs.map(s => [s.person_id, s.answer]), [[OWNER, 'sign']]);
  unchanged(f, () => f.call('protocols.respond', {id: 'proto-subj-v4', answer: 'sign'}), 'already_answered');
  unchanged(f, () => f.call('protocols.propose', {...spec, id: 'no-such-line', seeds: [0]}), 'not_found');
  // No notification for Nadia's own proposal.
  assert.ok(!f.call('notifications.list').items.some(n => n.object_id === 'proto-subj-v4'));
  f.event(answered(ny('04', '10:00:00'), 'proto-subj-v4', 'person-okafor', 'sign', 'Fine with five seeds.'));
  assert.deepEqual(f.call('protocols.list', {line: 'subject-eval'}).items.map(p => [p.id, p.state]),
    [['proto-subj-v1', 'superseded'], ['proto-subj-v2', 'superseded'], ['proto-subj-v3', 'declined'], ['proto-subj-v4', 'signed']]);
  const update = f.call('notifications.list').items.find(n => n.kind === 'protocol.updated' && n.object_id === 'proto-subj-v4');
  assert.ok(update.text.includes('proto-subj-v2 is superseded'), update.text);
  // Results under v2 now read protocol_superseded.
  assert.deepEqual(f.call('jobs.get', {id: 'job-0101'}).result.flags, ['protocol_superseded']);
  // A withdrawal is only of the account holder's own proposed version, and changes no other version.
  f.advance(ny('04', '11:00:00'));
  const mineV5 = f.call('protocols.propose', {...spec, seeds: [0, 1, 2, 3, 4, 5]});
  unchanged(f, () => f.call('protocols.respond', {id: mineV5.id, answer: 'sign'}), 'already_answered');
  assert.deepEqual(f.call('protocols.withdraw', {id: mineV5.id, note: 'Six is too many.'}), {id: 'proto-subj-v5', state: 'withdrawn'});
  assert.equal(f.call('protocols.get', {id: 'proto-subj-v4'}).protocol.state, 'signed');
  unchanged(f, () => f.call('protocols.withdraw', {id: 'proto-subj-v5'}), 'invalid_state');
  f.event(proposed(ny('04', '12:00:00'), 'proto-subj-v6', {seeds: [0, 1]}));
  unchanged(f, () => f.call('protocols.withdraw', {id: 'proto-subj-v6'}), 'not_yours');
  // A researcher who is not a required signer cannot answer.
  const g = fixture({seed: withPolicy(p => { p.required_signers = ['person-okafor']; }), now: NOW});
  g.event(proposed(ny('03', '11:00:00'), 'proto-subj-v3'));
  unchanged(g, () => g.call('protocols.respond', {id: 'proto-subj-v3', answer: 'sign'}), 'not_a_signer');
  assert.ok(!g.call('notifications.list').items.some(n => n.object_id === 'proto-subj-v3'), 'no request to sign for a person who is not a signer');
  // A proposal by a required signer with no other signature missing is signed at once.
  const solo = fixture({seed: withPolicy(p => { p.required_signers = [OWNER]; }), now: NOW});
  const signed = solo.call('protocols.propose', {...spec, seeds: [0, 1, 2, 3]});
  assert.deepEqual([signed.state, solo.call('protocols.get', {id: 'proto-subj-v2'}).protocol.state], ['signed', 'superseded']);
});

test('T13 [W3] expiry: a version still proposed at its respond_by reads expired after env.advance_time with no App event; a later answer is invalid_event, and the line takes a new proposal', () => {
  const f = start();
  f.event(proposed(ny('03', '11:00:00'), 'proto-subj-v3'));
  f.advance(ny('08', '10:59:59'));
  assert.equal(f.call('protocols.get', {id: 'proto-subj-v3'}).protocol.state, 'proposed');
  const before = f.data;
  f.advance(ny('08', '11:00:00'));
  assert.equal(f.call('protocols.get', {id: 'proto-subj-v3'}).protocol.state, 'expired');
  assert.deepEqual(f.data, before);
  unchanged(f, () => f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'sign'}), 'invalid_state');
  unchanged(f, () => f.event(answered(ny('08', '12:00:00'), 'proto-subj-v3', 'person-okafor')), 'invalid_event', 'an answer after respond_by', 'expired');
  unchanged(f, () => f.event(event('protocol.withdrawn', ny('08', '12:00:00'), {protocol_id: 'proto-subj-v3'})), 'invalid_event', 'a withdrawal after respond_by');
  f.event(proposed(ny('08', '12:00:00'), 'proto-subj-v4', {seeds: [0, 1, 2, 3, 4]}));
  assert.equal(f.call('protocols.list', {state: 'proposed'}).items[0].id, 'proto-subj-v4');
  // respond_by keeps the wall time across a clock change: 5 days from 30 October 2026, 09:00 EDT, is 4 November, 09:00 EST.
  const g = fixture({seed: SEED, now: '2026-10-30T08:00:00-04:00'});
  g.event(proposed('2026-10-30T09:00:00-04:00', 'proto-other-v1', {line: 'other-eval'}));
  assert.equal(g.call('protocols.get', {id: 'proto-other-v1'}).protocol.respond_by, '2026-11-04T09:00:00-05:00');
});

test('T14 [W4] results.update: tag, note, exclude with a reason and bring back; nothing is deleted, and a labmate\'s result or a job with no result is refused', () => {
  const f = start(), id = f.call('jobs.list', {owner_person_id: OWNER, config_id: 'cfg-vit-s16-v2'}).items[0].id;
  let out = f.call('results.update', {id, tags: ['paper', 'paper', 'baseline'], note: 'Seed 0 of the baseline.'});
  assert.deepEqual(out, {id, state: 'candidate', tags: ['paper', 'baseline'], note: 'Seed 0 of the baseline.'});
  unchanged(f, () => f.call('results.update', {id, disposition: 'excluded'}), 'reason_required');
  out = f.call('results.update', {id, disposition: 'excluded', reason: 'Wrong learning rate.'});
  assert.equal(out.state, 'excluded');
  let r = f.call('jobs.get', {id}).result;
  assert.deepEqual([r.state, r.exclusion_reason, r.tags, r.note], ['excluded', 'Wrong learning rate.', ['paper', 'baseline'], 'Seed 0 of the baseline.']);
  assert.deepEqual(f.call('results.list', {state: 'excluded'}).items.map(x => x.id), [id]);
  f.call('results.update', {id, disposition: 'candidate', note: null});
  r = f.call('jobs.get', {id}).result;
  assert.deepEqual([r.state, r.exclusion_reason, r.note], ['candidate', null, null]);
  unchanged(f, () => f.call('results.update', {id: 'job-0101', tags: ['x']}), 'not_yours');
  unchanged(f, () => f.call('results.update', {id: queuedPair(f)[0], tags: ['x']}), 'not_completed');
  unchanged(f, () => f.call('results.update', {id: 'job-none', tags: ['x']}), 'not_found');
  unchanged(f, () => f.call('results.update', {id}), SCHEMA, 'no field');
});

// The W4 table: row 1 cites Mei's three results of cfg-mae-b16-v2, row 2 Nadia's three results of cfg-vit-s16-v2, all under proto-subj-v2.
const ROWS = f => [{name: 'MAE-B/16 v2', result_ids: ['job-0101', 'job-0102', 'job-0103']},
  {name: 'ViT-S/16 v2', result_ids: f.call('jobs.list', {owner_person_id: OWNER, config_id: 'cfg-vit-s16-v2'}).items.map(j => j.id)}];
test('T15 [W4] tables: "Main results" under proto-subj-v2 with two rows of three results freezes; accuracy 0.712, 0.705 and 0.719 read count 3, mean 0.7120 and sd 0.0070', () => {
  const f = start();
  unchanged(f, () => f.call('tables.create', {id: 'proto-subj-v99', title: 'Main results'}), 'not_found', 'an unknown protocol version');
  const made = f.call('tables.create', {id: 'proto-subj-v2', title: 'Main results'});
  assert.deepEqual(made, {id: 'tbl-0001.v1', table_id: 'tbl-0001', table_version: 1, state: 'draft'});
  assert.deepEqual(f.call('tables.get', {id: made.id}).table.flags, ['empty_table']);
  const v1 = f.call('jobs.list', {protocol_id: 'proto-subj-v1'}).items.find(j => j.has_result).id;
  unchanged(f, () => f.call('tables.update', {id: made.id, rows: [{name: 'Old', result_ids: [v1]}]}), 'mixed_protocols');
  const none = f.call('jobs.list', {config_id: 'cfg-birch-abl-v1', state: 'completed'}).items[0].id;
  unchanged(f, () => f.call('tables.update', {id: made.id, rows: [{name: 'Birch', result_ids: [none]}]}), 'mixed_protocols', 'a result under no protocol');
  unchanged(f, () => f.call('tables.update', {id: made.id, rows: [{name: 'A', result_ids: ['job-0101']}, {name: 'B', result_ids: ['job-0101']}]}), 'duplicate_result');
  unchanged(f, () => f.call('tables.update', {id: made.id, rows: [{name: 'A', result_ids: [queuedPair(f)[0]]}]}), 'not_completed');
  unchanged(f, () => f.call('tables.update', {id: made.id, rows: [{name: 'A', result_ids: ['job-none']}]}), 'not_found');
  unchanged(f, () => f.call('tables.update', {id: made.id, rows: [{name: 'A', result_ids: ['job-0101']}, {name: 'A', result_ids: ['job-0102']}]}), 'invalid_arguments');
  unchanged(f, () => f.call('tables.update', {id: made.id, rows: [{name: 'A', result_ids: []}]}), SCHEMA);
  assert.deepEqual(f.call('tables.update', {id: made.id, rows: ROWS(f)}), {id: made.id, state: 'draft', rows: 2, flags: []});
  f.advance(ny('02', '08:00:00'));
  const frozen = f.call('tables.freeze', {id: made.id});
  assert.deepEqual([frozen.state, frozen.superseded], ['frozen', null]);
  const t = f.call('tables.get', {id: made.id}).table;
  const row = t.manifest.rows[0];
  assert.deepEqual([row.config_id, row.seeds, row.result_ids, row.metrics.accuracy], ['cfg-mae-b16-v2', [0, 1, 2], ['job-0101', 'job-0102', 'job-0103'], {count: 3, mean: 0.712, sd: 0.007}]);
  assert.deepEqual(t.manifest.rows[1].metrics.accuracy, {count: 3, mean: 0.6947, sd: 0.006});
  const {content_hash, ...body} = t.manifest;
  assert.equal(content_hash, 'sha256:' + crypto.createHash('sha256').update(canonical(body)).digest('hex'));
  assert.equal(t.csv.split('\n')[1], 'MAE-B/16 v2,cfg-mae-b16-v2,0 1 2,job-0101 job-0102 job-0103,3,0.7120,0.0070');
  assert.equal(t.csv.split('\n')[0], 'row,config_id,seeds,result_ids,accuracy_count,accuracy_mean,accuracy_sd');
  unchanged(f, () => f.call('tables.update', {id: made.id, rows: ROWS(f)}), 'invalid_state');
  unchanged(f, () => f.call('tables.freeze', {id: made.id}), 'invalid_state');
  unchanged(f, () => f.call('tables.discard', {id: made.id}), 'invalid_state');
  assert.deepEqual(f.call('tables.list', {state: 'frozen'}).items.map(x => [x.id, x.rows, x.flags]), [[made.id, 2, []]]);
});

test('T16 [W4] freeze checks, in order: empty_table, protocol_not_signed, incomplete_seeds, cites_excluded, cites_invalidated; a draft can be discarded', () => {
  const f = start(), rows = ROWS(f);
  const a = f.call('tables.create', {id: 'proto-subj-v2', title: 'A'}).id;
  unchanged(f, () => f.call('tables.freeze', {id: a}), 'empty_table');
  f.event(proposed(ny('02', '07:30:00'), 'proto-subj-v3', {eval_split: 'test-subjects', seeds: [0, 1]}));
  const b = f.call('tables.create', {id: 'proto-subj-v3', title: 'B'}).id;
  unchanged(f, () => f.call('tables.freeze', {id: b}), 'empty_table', 'empty comes first');
  f.call('tables.update', {id: a, rows: [{name: 'Two seeds', result_ids: ['job-0101', 'job-0102']}]});
  assert.deepEqual(f.call('tables.get', {id: a}).table.flags, ['incomplete_seeds']);
  unchanged(f, () => f.call('tables.freeze', {id: a}), 'incomplete_seeds', 'only seeds 0 and 1');
  f.call('tables.update', {id: a, rows: [{name: 'Mixed', result_ids: ['job-0101', 'job-0102', rows[1].result_ids[2]]}]});
  unchanged(f, () => f.call('tables.freeze', {id: a}), 'incomplete_seeds', 'two configs in one row');
  f.call('tables.update', {id: a, rows: [rows[1]]});
  f.call('results.update', {id: rows[1].result_ids[0], disposition: 'excluded', reason: 'Bad node.'});
  assert.deepEqual(f.call('tables.get', {id: a}).table.flags, ['cites_excluded']);
  unchanged(f, () => f.call('tables.freeze', {id: a}), 'cites_excluded');
  f.call('results.update', {id: rows[1].result_ids[0], disposition: 'candidate'});
  f.event(event('result.invalidated', ny('02', '08:00:00'), {job_id: rows[1].result_ids[1], invalidated_by: 'person-mei', reason: 'Cached split.'}));
  unchanged(f, () => f.call('tables.freeze', {id: a}), 'cites_invalidated');
  // A table under a version that is not signed cannot be frozen.
  const v3 = f.call('jobs.submit', {...SUBMIT, id: 'cfg-vit-s16-v2', partition_id: 'gpu-a', gpus: 1, seed: 0, protocol_id: 'proto-subj-v3'}).id;
  f.advance(ny('03', '07:00:00'));
  f.call('tables.update', {id: b, rows: [{name: 'One', result_ids: [v3]}]});
  unchanged(f, () => f.call('tables.freeze', {id: b}), 'protocol_not_signed');
  assert.deepEqual(f.call('tables.get', {id: b}).table.flags, ['incomplete_seeds', 'protocol_unsigned']);
  assert.deepEqual(f.call('tables.discard', {id: b}), {id: b, state: 'discarded'});
  unchanged(f, () => f.call('tables.discard', {id: b}), 'invalid_state');
});

test('T17 [W4] correction: an invalidated result leaves the frozen table unchanged with the flag cites_invalidated; tables.revise starts version 2, a rerun replaces the result, and freezing it supersedes version 1', () => {
  const f = start(), id = f.call('tables.create', {id: 'proto-subj-v2', title: 'Main results'}).id;
  f.call('tables.update', {id, rows: ROWS(f)});
  f.call('tables.freeze', {id});
  unchanged(f, () => f.call('tables.revise', {id: 'tbl-0001.v9'}), 'not_found');
  const before = f.call('tables.get', {id}).table;
  f.event(PLAN['ev-bl-240']);
  const after = f.call('tables.get', {id}).table;
  assert.deepEqual(after.manifest, before.manifest);
  assert.deepEqual([before.flags, after.flags], [[], ['cites_invalidated']]);
  const notice = f.call('notifications.list').items.find(n => n.kind === 'result.invalidated');
  assert.ok(notice.text.includes('tbl-0001.v1'), notice.text);
  // The rerun of seed 1, with the fixed split.
  f.event(planSet(ny('06', '15:00:00'), 'cfg-mae-b16-v2', {seed: 1, queue_wait_minutes: 10, run_minutes: 600, metrics: {accuracy: 0.708}}));
  const rerun = f.call('jobs.submit', {id: 'cfg-mae-b16-v2', seed: 1, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12, protocol_id: 'proto-subj-v2'}).id;
  const draft = f.call('tables.revise', {id});
  assert.deepEqual(draft, {id: 'tbl-0001.v2', table_version: 2, state: 'draft', revises: id});
  unchanged(f, () => f.call('tables.revise', {id}), 'invalid_state', 'a table with a draft');
  assert.deepEqual(f.call('tables.get', {id: draft.id}).table.rows, before.rows);
  unchanged(f, () => f.call('tables.update', {id: draft.id, rows: [{name: 'MAE-B/16 v2', result_ids: ['job-0101', rerun, 'job-0103']}]}), 'not_completed');
  f.advance(ny('07', '01:30:00'));
  f.call('tables.update', {id: draft.id, rows: [{name: 'MAE-B/16 v2', result_ids: ['job-0101', rerun, 'job-0103']}, ROWS(f)[1]]});
  const out = f.call('tables.freeze', {id: draft.id});
  assert.deepEqual([out.state, out.superseded], ['frozen', id]);
  assert.deepEqual(f.call('tables.list').items.map(t => [t.id, t.state]), [[id, 'superseded'], [draft.id, 'frozen']]);
  assert.deepEqual(f.call('tables.get', {id: draft.id}).table.manifest.rows[0].metrics.accuracy, {count: 3, mean: 0.713, sd: 0.0056});
  unchanged(f, () => f.call('tables.revise', {id}), 'invalid_state', 'a superseded version');
  assert.equal(f.call('tables.revise', {id: draft.id}).id, 'tbl-0001.v3');
});

test('T17b [W4] a frozen table only gains flags: a later exclusion reads cites_excluded, a newly signed version reads protocol_superseded, and an invalidation keeps the disposition of the result', () => {
  const f = start(), id = f.call('tables.create', {id: 'proto-subj-v2', title: 'Main results'}).id, rows = ROWS(f);
  f.call('tables.update', {id, rows});
  f.call('tables.freeze', {id});
  const manifest = f.call('tables.get', {id}).table.manifest, mineId = rows[1].result_ids[0];
  f.call('results.update', {id: mineId, tags: ['paper'], disposition: 'excluded', reason: 'Bad node.'});
  assert.deepEqual(f.call('tables.get', {id}).table.flags, ['cites_excluded']);
  // An invalidation keeps the exclusion, its reason and the tags.
  f.event(event('result.invalidated', ny('02', '08:00:00'), {job_id: mineId, invalidated_by: 'person-mei', reason: 'Cached split.'}));
  const r = f.call('jobs.get', {id: mineId}).result;
  assert.deepEqual([r.state, r.exclusion_reason, r.tags, r.flags], ['excluded', 'Bad node.', ['paper'], ['invalidated']]);
  assert.deepEqual(f.call('tables.get', {id}).table.flags, ['cites_excluded', 'cites_invalidated']);
  // A new signed version of the line.
  f.event(proposed(ny('02', '08:10:00'), 'proto-subj-v3', {eval_split: 'test-subjects', seeds: [0, 1, 2, 3]}));
  f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'sign'});
  f.event(answered(ny('02', '08:20:00'), 'proto-subj-v3', 'person-okafor'));
  const t = f.call('tables.get', {id}).table;
  assert.deepEqual([t.stored_state, t.flags], ['frozen', ['cites_excluded', 'cites_invalidated', 'protocol_superseded']]);
  assert.deepEqual(t.manifest, manifest, 'the manifest never changes');
});

test('T19i [All] job_end_notices is read once: turning it off after a submission keeps the pending notice, which is listed at the end of the job', () => {
  const f = start();
  f.advance(ny('02'));
  const {id} = f.call('jobs.submit', SUBMIT);
  f.call('preferences.update', {job_end_notices: false, email_notices: false});
  const n = f.data.notifications.find(x => x.object_id === id && x.kind === 'job.ended');
  assert.deepEqual([n.removed_at, n.email !== null], [null, true], 'the pending notice and its stored message are untouched');
  f.advance(ny('02', '19:30:00'));
  assert.ok(f.call('notifications.list').items.some(x => x.id === n.id));
});

test('T18 [All] invalid events: each event of the plan\'s list is rejected with invalid_event, and the data does not change', () => {
  const f = start();
  const no = (e, label, text) => unchanged(f, () => f.event(e), 'invalid_event', label, text);
  // A duplicate job, config or protocol ID.
  no(recorded(ny('02', '08:00:00'), 'job-0101'), 'a duplicate job ID', 'already exists');
  no(event('config.registered', ny('02', '08:00:00'), {config_id: 'cfg-atlas-v1', family: 'atlas', version: 9, params: {}, dataset_version: 'd', eval_split: 's', code_ref: 'x', registered_by: 'person-mei'}), 'a duplicate config ID');
  no(proposed(ny('02', '08:00:00'), 'proto-subj-v2'), 'a duplicate protocol ID');
  // An unknown person, partition, config or protocol version.
  no(recorded(ny('02', '08:00:00'), 'job-0200', {owner_person_id: 'person-zed'}), 'an unknown owner', 'unknown');
  no(recorded(ny('02', '08:00:00'), 'job-0200', {partition_id: 'gpu-z'}), 'an unknown partition');
  no(recorded(ny('02', '08:00:00'), 'job-0200', {config_id: 'cfg-none'}), 'an unknown config');
  no(recorded(ny('02', '08:00:00'), 'job-0200', {protocol_id: 'proto-none'}), 'an unknown protocol version');
  no(script(ny('02', '08:00:00'), {config_id: 'cfg-none'}), 'a script job of an unknown config');
  no(script(ny('02', '08:00:00'), {partition_id: 'gpu-z'}), 'a script job on an unknown partition');
  no(script(ny('02', '08:00:00'), {protocol_id: 'proto-none'}), 'a script job under an unknown version');
  no(event('allocation.changed', ny('02', '08:00:00'), {allocation_hours: 300, changed_by: 'person-zed'}), 'an unknown person who changes the allocation');
  no(event('allocation.changed', ny('02', '08:00:00'), {shares: [{person_id: 'person-zed', share_hours: 10}], changed_by: 'person-okafor'}), 'a share of an unknown person');
  no(planSet(ny('02', '08:00:00'), 'cfg-none'), 'a plan for an unknown config');
  no(planSet(ny('02', '08:00:00'), 'cfg-atlas-v1', {partition_id: 'gpu-z'}), 'a plan on an unknown partition');
  no(event('job.interrupted', ny('02', '08:00:00'), {job_id: 'job-none'}), 'an interruption of an unknown job');
  no(event('result.invalidated', ny('02', '08:00:00'), {job_id: 'job-0101', invalidated_by: 'person-zed'}), 'an invalidation by an unknown person');
  // An event that names the account holder as owner, proposer or signer, or withdraws the account holder's version.
  no(recorded(ny('02', '08:00:00'), 'job-0200', {owner_person_id: OWNER}), 'the account holder as owner', 'account holder');
  no(proposed(ny('02', '08:00:00'), 'proto-subj-v3', {proposed_by: OWNER}), 'the account holder as proposer');
  f.event(proposed(ny('02', '08:00:00'), 'proto-subj-v3'));
  no(answered(ny('02', '08:10:00'), 'proto-subj-v3', OWNER), 'the account holder as signer');
  // A recorded job that ends before it starts, runs longer than its time limit, or names a version that does not cover it.
  no(recorded(ny('02', '08:20:00'), 'job-0200', {starts_at: ny('02', '09:00:00'), ends_at: ny('02', '08:59:00')}), 'a job that ends before it starts', 'ends before');
  no(recorded(ny('02', '08:20:00'), 'job-0200', {starts_at: ny('02', '09:00:00'), ends_at: ny('02', '21:00:01')}), 'a job that runs longer than its limit', 'longer');
  no(recorded(ny('02', '08:20:00'), 'job-0200', {seed: 7}), 'a job with a seed that its version does not cover', 'does not cover');
  no(recorded(ny('02', '08:20:00'), 'job-0200', {config_id: 'cfg-vit-s16-v1'}), 'a job with a config that its version does not cover');
  // An interruption of a job that is not queued or running at the event's time.
  no(event('job.interrupted', ny('02', '08:20:00'), {job_id: 'job-0101'}), 'an interruption after the job ended', 'Only a queued or running');
  // A second proposed version on one line.
  no(proposed(ny('02', '08:30:00'), 'proto-subj-v9'), 'a second proposed version on one line', 'already has the proposed version');
  // An answer from a person who is not a required signer or has already answered.
  no(answered(ny('02', '08:30:00'), 'proto-subj-v3', 'person-mei'), 'an answer from a person who is not a signer', 'not a required signer');
  f.event(answered(ny('02', '08:40:00'), 'proto-subj-v3', 'person-okafor'));
  no(answered(ny('02', '08:50:00'), 'proto-subj-v3', 'person-okafor', 'decline'), 'a second answer', 'already answered');
  // An answer or a withdrawal for a version that is not proposed.
  f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'decline'});
  // Every signer has answered proto-subj-v3, so its state comes after "already answered". T13 checks an answer after respond_by.
  no(event('protocol.withdrawn', ny('02', '09:00:00'), {protocol_id: 'proto-subj-v3'}), 'a withdrawal of a declined version', 'Only a proposed');
  // A withdrawal of the account holder's own version.
  f.advance(ny('02', '09:10:00'));
  const own = f.call('protocols.propose', {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2, 3]});
  no(event('protocol.withdrawn', ny('02', '09:20:00'), {protocol_id: own.id}), 'a withdrawal of the account holder\'s version', 'account holder');
  // An invalidation of a job that has no result.
  no(event('result.invalidated', ny('02', '09:30:00'), {job_id: queuedPair(f)[0], invalidated_by: 'person-mei'}), 'an invalidation of a job with no result', 'has no result');
  // Like Core, an event dated before the current time is refused.
  no(recorded(ny('02', '06:00:00'), 'job-0200'), 'an event in the past', 'backwards');
});

test('T18b [All] invalid events: each structure check that the package adds is rejected, with invalid_event or by the event schema, and the data does not change', () => {
  const f = start();
  const no = (e, code, label) => unchanged(f, () => f.event(e), code, label);
  no(event('allocation.changed', ny('02', '08:00:00'), {allocation_hours: 120.555, changed_by: 'person-okafor'}), 'invalid_event', 'hours with three decimals');
  no(event('allocation.changed', ny('02', '08:00:00'), {shares: [{person_id: 'person-mei', share_hours: 10}, {person_id: 'person-mei', share_hours: 20}], changed_by: 'person-okafor'}), 'invalid_event', 'one person twice');
  no(event('allocation.changed', ny('02', '08:00:00'), {changed_by: 'person-okafor'}), EVENT_SCHEMA, 'neither allocation nor shares');
  no(recorded(ny('02', '08:00:00'), 'job-0200', {time_limit_hours: 12.125}), 'invalid_event', 'a limit with three decimals');
  no(recorded(ny('02', '08:00:00'), 'job-0200', {metrics: {Accuracy: 0.7}}), 'invalid_event', 'a metric with a bad name');
  no(recorded(ny('02', '08:00:00'), 'job-0200', {metrics: {}}), 'invalid_event', 'no metric');
  no(recorded(ny('02', '08:00:00'), 'job-0200', {end_kind: 'failed'}), EVENT_SCHEMA, 'a failed job with metrics');
  no(recorded(ny('02', '08:00:00'), 'job-0200', {metrics: undefined}), EVENT_SCHEMA, 'a completed job with no metrics');
  no(planSet(ny('02', '08:00:00'), 'cfg-atlas-v1', {outcome: 'failed'}), EVENT_SCHEMA, 'a failed plan with metrics');
  no(planSet(ny('02', '08:00:00'), 'cfg-atlas-v1', {metrics: {'bad name': 1}}), 'invalid_event', 'a plan metric with a bad name');
  no(script(ny('02', '08:00:00'), {time_limit_hours: 1.001}), 'invalid_event', 'a script limit with three decimals');
  no(proposed(ny('02', '08:00:00'), 'proto-subj-v3', {seeds: [0, 0, 1]}), 'invalid_event', 'a seed twice');
  no(proposed(ny('02', '08:00:00'), 'proto-subj-v3', {metrics: [{name: 'accuracy', direction: 'higher'}, {name: 'accuracy', direction: 'lower'}]}), 'invalid_event', 'a metric twice');
  no(proposed(ny('02', '08:00:00'), 'proto-subj-v3', {seeds: []}), EVENT_SCHEMA, 'no seed');
  no(event('config.registered', ny('02', '08:00:00'), {config_id: 'cfg-new', family: 'atlas', version: 4, params: {}, dataset_version: 'd', eval_split: 's', code_ref: 'x', registered_by: 'person-zed'}), 'invalid_event', 'an unknown person registers a config');
  no(event('benchline.no.such', ny('02', '08:00:00'), {}), EVENT_SCHEMA, 'an unknown operation');
});

test('T19 [All] notifications: one for each occurrence of the seven types, none for the account holder\'s own writes or for a change of time; job.ended is listed only from the end of the job', () => {
  const f = start(), count = () => f.data.notifications.length;
  // Own writes write no notification, except job.ended while job_end_notices is on.
  let n = count();
  f.call('results.update', {id: mine(f, 'completed')[0].id, tags: ['x']});
  f.call('tables.create', {id: 'proto-subj-v2', title: 'T'});
  f.call('preferences.update', {timezone: 'Europe/Berlin'});
  assert.equal(count(), n);
  f.advance(ny('02'));
  const {id} = f.call('jobs.submit', SUBMIT);
  const ended = f.data.notifications[count() - 1];
  assert.deepEqual([ended.kind, ended.at, ended.object_id, ended.request_id, ended.event_id], ['job.ended', ny('02', '19:30:00'), id, 'local-4', null]);
  assert.equal(ended.title, 'Your job ' + id + ' has completed');
  assert.ok(ended.text.includes('completed on 3 December at 01:30'), ended.text);
  f.advance(ny('02', '19:29:59'));
  assert.ok(!f.call('notifications.list').items.some(x => x.id === ended.id));
  f.advance(ny('02', '19:30:00'));
  assert.ok(f.call('notifications.list').items.some(x => x.id === ended.id));
  // Labmates' jobs and plans write none.
  n = count();
  f.event(recorded(ny('02', '20:00:00'), 'job-0200'));
  f.event(planSet(ny('02', '20:01:00'), 'cfg-atlas-v3'));
  f.event(event('config.registered', ny('02', '20:02:00'), {config_id: 'cfg-new-v1', family: 'new', version: 1, params: {}, dataset_version: 'd', eval_split: 's', code_ref: 'x', registered_by: 'person-mei'}));
  assert.equal(count(), n);
  // An interruption of the account holder's job writes job.interrupted and removes its pending job.ended notice.
  const job = f.call('jobs.submit', {...SUBMIT, seed: 1, id: 'cfg-mae-b16-v3'}).id;
  const pending = f.data.notifications.find(x => x.object_id === job && x.kind === 'job.ended');
  assert.equal(pending, undefined, 'the seed-1 job has no plan yet, so no end and no notice');
  f.event(planSet(ny('02', '20:10:00'), 'cfg-mae-b16-v3', {seed: 1, queue_wait_minutes: 240}));
  const planned = f.data.notifications.find(x => x.object_id === job && x.kind === 'job.ended');
  assert.equal(planned.at, ny('03', '10:10:00'));
  f.event(event('job.interrupted', ny('02', '23:00:00'), {job_id: job, reason: 'Node gpu-h-07 failed.'}));
  const data = f.data;
  assert.equal(data.notifications.find(x => x.id === planned.id).removed_at, ny('02', '23:00:00'));
  const interrupted = data.notifications[data.notifications.length - 1];
  assert.deepEqual([interrupted.kind, interrupted.object_id], ['job.interrupted', job]);
  f.advance(ny('04'));
  assert.ok(!f.call('notifications.list').items.some(x => x.id === planned.id), 'a removed notice is never listed');
  // A labmate's interruption writes none. A hold or a cancellation removes the pending notice too.
  n = count();
  f.event(recorded(ny('04', '09:10:00'), 'job-0201', {starts_at: ny('04', '09:20:00'), ends_at: ny('04', '18:00:00')}));
  f.event(event('job.interrupted', ny('04', '10:00:00'), {job_id: 'job-0201'}));
  assert.equal(count(), n);
  const g = start();
  g.advance(ny('02'));
  const a = g.call('jobs.submit', SUBMIT).id;
  g.call('jobs.hold', {id: a});
  g.call('jobs.release', {id: a});
  g.call('jobs.cancel', {id: a});
  assert.deepEqual(g.data.notifications.filter(x => x.object_id === a).map(x => [x.at, x.removed_at]), [[ny('02', '19:30:00'), ny('02')], [ny('02', '19:30:00'), ny('02')]]);
  assert.deepEqual(g.data.activity.filter(r => r.effect).slice(-4).map(r => r.action), ['notification.written', 'notification.removed', 'notification.written', 'notification.removed']);
  // job_end_notices and email_notices are read once, when the notice is written.
  const h = start();
  h.call('jobs.cancel', {id: queuedPair(h)[0]});
  h.call('preferences.update', {email_notices: false});
  h.advance(ny('02'));
  const b = h.call('jobs.submit', SUBMIT).id;
  h.call('preferences.update', {email_notices: true, job_end_notices: false});
  const c = h.call('jobs.submit', {...SUBMIT, id: 'cfg-vit-s16-v2', seed: 0, partition_id: 'gpu-a', gpus: 1}).id;
  assert.equal(h.data.notifications.find(x => x.object_id === b).email, null);
  assert.equal(h.data.notifications.find(x => x.object_id === c), undefined);
  unchanged(h, () => h.call('preferences.update', {timezone: 'Mars/Olympus'}), 'invalid_timezone');
  unchanged(h, () => h.call('preferences.update', {}), SCHEMA);
  // Seven types in all.
  assert.deepEqual(require('../tools.json').find(t => t.name === 'benchline.notifications.list').outputSchema.properties.items.items.properties.kind.enum, NOTICE_KINDS);
});

test('T19g [All] allocation.changed writes one notice when the allocation or the researcher\'s share changes, and none when only a labmate\'s share changes or nothing changes', () => {
  const f = start(), count = () => f.data.notifications.filter(n => n.kind === 'allocation.changed').length;
  const n0 = count();
  f.event(event('allocation.changed', ny('02', '08:00:00'), {shares: [{person_id: 'person-mei', share_hours: 90}], changed_by: 'person-okafor'}));
  assert.equal(count(), n0, 'a labmate\'s share only: no notice');
  f.event(event('allocation.changed', ny('02', '08:10:00'), {allocation_hours: 400, shares: [{person_id: OWNER, share_hours: 150}], changed_by: 'person-okafor'}));
  assert.equal(count(), n0, 'the same values again: no notice');
  f.event(event('allocation.changed', ny('02', '08:20:00'), {shares: [{person_id: OWNER, share_hours: 100}], changed_by: 'person-okafor', reason: 'Mei needs more hours this month.'}));
  assert.equal(count(), n0 + 1, 'the researcher\'s share only: one notice');
  const n = f.data.notifications[f.data.notifications.length - 1];
  assert.equal(n.title, 'Your share of the December allocation is now 100 GPU-hours');
  assert.ok(n.text.startsWith('Your share of Prof. Okafor\'s project allocation for 1 to 31 December changed. Reason given: Mei needs more hours this month. Your share is now 100 GPU-hours, from 150.'), n.text);
  f.event(event('allocation.changed', ny('02', '08:30:00'), {allocation_hours: 380, changed_by: 'person-okafor'}));
  assert.equal(count(), n0 + 2, 'the allocation only: one notice');
});

test('T19h [All] notice text keeps the case of acronyms, names and titles in a given reason, and lowers only an ordinary first word', () => {
  const f = start();
  const last = () => f.data.notifications[f.data.notifications.length - 1].text;
  f.event(event('allocation.changed', ny('02', '08:00:00'), {allocation_hours: 380, changed_by: 'person-okafor', reason: 'NSF cut the grant for this quarter.'}));
  assert.ok(last().includes('Reason given: NSF cut the grant for this quarter.'), last());
  f.event(event('allocation.changed', ny('02', '08:10:00'), {allocation_hours: 370, changed_by: 'person-okafor', reason: 'Prof. Okafor moved hours to Mei.'}));
  assert.ok(last().includes('Reason given: Prof. Okafor moved hours to Mei.'), last());
  f.event(event('allocation.changed', ny('02', '08:20:00'), {allocation_hours: 360, changed_by: 'person-okafor', reason: 'H100 nodes are down.'}));
  assert.ok(last().includes('Reason given: H100 nodes are down.'), last());
  f.event(event('allocation.changed', ny('02', '08:30:00'), {allocation_hours: 350, changed_by: 'person-okafor', reason: 'Hours went to the course.'}));
  assert.ok(last().includes('Reason given: hours went to the course.'), last());
});

test('T19b [All] the ten example events of the plan apply to the task seed in time order, with the agent\'s steps of W3 between them, and the allocation notice is the plan\'s example message with one sentence for the share', () => {
  const f = start(), steps = [
    () => f.event(PLAN['ev-bl-210']), () => f.event(PLAN['ev-bl-225']),
    () => f.event(planSet('2026-12-02T21:00:00-05:00', 'cfg-birch-abl-v1', {queue_wait_minutes: 60, run_minutes: 600})), () => f.event(PLAN['ev-bl-212']),
    () => f.event(PLAN['ev-bl-201']), () => f.event(PLAN['ev-bl-220']), () => f.event(PLAN['ev-bl-230']),
    () => { f.advance(ny('03', '14:00:00')); f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'decline'}); },
    () => f.call('protocols.propose', {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2, 3, 4]}),
    () => f.event(recorded(ny('03', '20:00:00'), 'job-0140', {owner_person_id: 'person-farid', starts_at: ny('03', '20:10:00'), ends_at: ny('04', '06:00:00')})),
    () => f.event(PLAN['ev-bl-215']), () => f.event(PLAN['ev-bl-231']),
    () => f.event(proposed(ny('04', '11:00:00'), 'proto-subj-v5', {eval_split: 'test-subjects', seeds: [0, 1, 2, 3, 4, 5]})), () => f.event(PLAN['ev-bl-232']),
    () => f.event(PLAN['ev-bl-240'])
  ];
  for (const step of steps) step();
  const data = f.data, by = id => data.notifications.find(n => n.event_id === id);
  assert.equal(data.jobs.find(j => j.id === 'job-0131').owner_person_id, 'person-mei');
  // Mei's job of ev-bl-210 used 86 GPU-hours, so the script's job of 48 does not fit what is left (42): no job, and one notice that names the error.
  assert.equal(data.jobs.find(j => j.event_id === 'ev-bl-212'), undefined);
  assert.deepEqual(by('ev-bl-212').details, {script: 'birch-ablations.sh', config_id: 'cfg-birch-abl-v1', seed: 0, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12,
    protocol_id: null, hold: false, error: 'over_allocation'});
  assert.equal(data.jobs.find(j => j.id === 'job-0140').stored_state, 'interrupted');
  assert.deepEqual(data.protocols.map(p => [p.id, p.stored_state]), [['proto-subj-v1', 'superseded'], ['proto-subj-v2', 'superseded'], ['proto-subj-v3', 'declined'],
    ['proto-subj-v4', 'signed'], ['proto-subj-v5', 'withdrawn']]);
  assert.ok(data.jobs.find(j => j.id === 'job-0102').invalidation);
  // The allocation notice: the plan's example message, with the share sentence that the same event makes. The ID follows the seed's notices.
  const plan = JSON.parse(PLAN_WIRE), notice = by('ev-bl-201');
  assert.ok(wireSchema(plan) && wireSchema(notice.email), 'both messages pass Mail\'s wire schema');
  const shareSentence = ' Your share is now 45 GPU-hours, from 150.';
  const expected = edit(plan, m => { m.id = notice.id; m.data.content.body.text = m.data.content.body.text.replace(' Two of your', shareSentence + ' Two of your'); });
  assert.deepEqual(notice.email, expected);
  assert.deepEqual(data.jobs.filter(j => j.hold_reason === 'allocation').map(j => j.config_id), ['cfg-mae-b16-v3', 'cfg-mae-b16-v3']);
  for (const [id, kind] of [['ev-bl-230', 'protocol.proposed'], ['ev-bl-231', 'protocol.updated'], ['ev-bl-232', 'protocol.updated']]) {
    assert.equal(by(id).kind, kind, id);
  }
  // A labmate's interruption, a recorded job, a plan and a config write no notice. Nor does the invalidation of Mei's result that no table of Nadia cites (T17 has one that a table cites).
  for (const id of ['ev-bl-210', 'ev-bl-215', 'ev-bl-220', 'ev-bl-225', 'ev-bl-240']) assert.equal(by(id), undefined, id);
  for (const n of data.notifications.filter(x => x.email)) assert.ok(wireSchema(n.email), n.id);
});

// A script that needs the public runtime. Without PALE_RUNTIME_ROOT the test is skipped, and a script that exits 77 is reported as skipped.
function withRuntime(script) {
  const runtime = process.env.PALE_RUNTIME_ROOT;
  const skip = !runtime ? 'Set PALE_RUNTIME_ROOT to the runtime folder of a PALE checkout to run ' + script + '.'
    : !fs.existsSync(path.join(ROOT, script)) ? script + ' is not in this copy of the package.' : false;
  return [{skip}, t => {
    const result = spawnSync(process.execPath, [script, '--runtime', path.resolve(runtime)], {cwd: ROOT, encoding: 'utf8', timeout: 300000});
    const reason = /^SKIP:? (.+)$/m.exec(result.stdout || '');
    if (result.status === 77) return t.skip(reason ? reason[1] : script + ' exited 77.');
    assert.equal(result.status, 0, script + ' failed:\n' + result.stdout + result.stderr);
  }];
}

test('T19c [All] Mail delivery: tests/mail.integration.cjs passes on the real runtime (a received message after its release time, an identical retry, no grant, and Benchline without Mail)',
  ...withRuntime('tests/mail.integration.cjs'));

// The Mail sender with fake connections: plain objects with `call`. The fake router remembers each identity, like the real one:
// the same message again is a duplicate, and another message under a known identity is a conflict. `answers` replaces its next answers.
function senderWorld(snapshot, answers = []) {
  const w = {snapshot, answers, reads: [], published: []}, known = new Map();
  w.infra = {call: async name => {
    assert.equal(name, 'env.snapshot', 'The sender only reads Benchline.');
    w.reads.push(name);
    return w.snapshot ? {status: 'ok', snapshot: structuredClone(w.snapshot)} : {status: 'permission_denied'};
  }};
  w.router = {call: async (name, {request_id, message}) => {
    assert.equal(name, 'router.publish');
    w.published.push({request_id, message});
    const answer = w.answers.shift(), first = known.get(request_id);
    if (answer instanceof Error) throw answer;
    if (answer) return answer;
    if (first) return JSON.stringify(first.message) === JSON.stringify(message) ? {...first.receipt, duplicate: true} : {status: 'rejected', code: 'idempotency_conflict'};
    known.set(request_id, {message, receipt: {status: 'committed', event_id: 'mail-' + (known.size + 1)}});
    return known.get(request_id).receipt;
  }};
  w.sender = firstEpoch => createSender({infra: w.infra, router: w.router, firstEpoch});
  return w;
}
// One lifecycle of the App as `env.snapshot` shows it: its epoch, the clock, the loaded seed and the current data.
const lifecycle = (epoch, f, seed = SEED) => ({epoch, virtual_now: f.ctx.virtual_now, initial_data: seed, data: f.data});
const delivered = (id, request_id, n) => ({notification_id: id, request_id, status: 'committed', code: null, event_id: 'mail-' + n, duplicate: false});
const undelivered = (id, {status, code}) => ({notification_id: id, request_id: id, status, code, event_id: null, duplicate: false});
const ALLOCATION = event('allocation.changed', ny('02', '08:00:00'), {allocation_hours: 450, changed_by: 'person-okafor', reason: 'Hours for the course came back.'}, 'ev-alloc');

test('T19d [All] Mail sender: a notification goes only once the clock has reached its release time, once, and never after it was removed', async () => {
  const f = start();
  f.event(ALLOCATION);
  f.advance(ny('02'));
  const {id} = f.call('jobs.submit', SUBMIT), [alloc, ended] = f.data.notifications.slice(-2).map(n => n.id);
  const w = senderWorld(lifecycle(2, f)), sender = w.sender();
  assert.deepEqual(await sender.publishPending(), {epoch: 2, firstEpoch: 2, lifecycle: 'first', results: [delivered(alloc, alloc, 1)], waiting: 1, stopped: false});
  f.advance(ny('02', '19:29:59'));
  w.snapshot = lifecycle(2, f);
  assert.deepEqual([(await sender.publishPending()).results, w.published.length], [[], 1]);
  f.advance(ny('02', '19:30:00'));
  w.snapshot = lifecycle(2, f);
  assert.deepEqual((await sender.publishPending()).results, [delivered(ended, ended, 2)]);
  assert.deepEqual((await sender.publishPending()).results, []);
  assert.ok(wireSchema(w.published[1].message) && w.published[1].message.time === ny('02', '19:30:00'));
  // A cancelled job's notice is removed before its release time, so it is never sent.
  const g = start();
  g.advance(ny('02'));
  const job = g.call('jobs.submit', SUBMIT).id;
  g.call('jobs.cancel', {id: job});
  g.advance(ny('03'));
  const v = senderWorld(lifecycle(2, g));
  assert.deepEqual(await v.sender().publishPending(), {epoch: 2, firstEpoch: 2, lifecycle: 'first', results: [], waiting: 0, stopped: false});
});

test('T19e [All] Mail sender: what the loaded seed held is never sent, a notice with no wire message is skipped, a refusal for lack of a route is final, and after a reset the ID is <id>.e<epoch>', async () => {
  const f = start();
  f.call('preferences.update', {email_notices: false});
  f.event(ALLOCATION);
  f.call('preferences.update', {email_notices: true});
  f.event(proposed(ny('02', '08:10:00'), 'proto-subj-v3'));
  f.event(answered(ny('02', '08:20:00'), 'proto-subj-v3', 'person-okafor'));
  const [a, b, c] = f.data.notifications.slice(-3);
  assert.deepEqual([a.email, !!b.email, !!c.email], [null, true, true]);
  for (const code of ['recipient_not_authorized', 'recipient_unavailable', 'ambiguous_recipient', 'unsupported_recipient']) {
    const w = senderWorld(lifecycle(2, f), [{status: 'rejected', code}]), sender = w.sender(), out = await sender.publishPending();
    assert.deepEqual([out.stopped, out.results], [false, [undelivered(b.id, {status: 'rejected', code}), delivered(c.id, c.id, 1)]], code);
    assert.deepEqual([(await sender.publishPending()).results, w.published.map(p => p.request_id)], [[], [b.id, c.id]], code);
  }
  // After env.reset the App has a new epoch and can make the same ID with other content.
  const g = start();
  g.event(ALLOCATION);
  g.event(proposed(ny('02', '08:10:00'), 'proto-subj-v3', {proposed_by: 'person-mei'}));
  const w = senderWorld(lifecycle(2, f)), first = await w.sender().publishPending();
  w.snapshot = lifecycle(3, g);
  const renewed = g.data.notifications[g.data.notifications.length - 1];
  assert.equal(renewed.id, b.id);
  // A sender that does not know the first epoch reuses the plain IDs: the router knows b.id with other content, so it stops there.
  assert.deepEqual((await w.sender().publishPending()).results.map(r => [r.request_id, r.code]), [[a.id, null], [b.id, 'idempotency_conflict']]);
  assert.deepEqual((await w.sender(first.firstEpoch).publishPending()).results.map(r => [r.request_id, r.status]), [[a.id + '.e3', 'committed'], [b.id + '.e3', 'committed']]);
  // A second seed that holds these notices as history: only what comes after them is new.
  const h = fixture({seed: f.data, now: f.ctx.virtual_now});
  h.event(event('allocation.changed', ny('02', '09:00:00'), {allocation_hours: 310, changed_by: 'person-okafor'}));
  const v = senderWorld(lifecycle(4, h, f.data));
  assert.deepEqual((await v.sender(2).publishPending()).results.map(r => r.request_id), [h.data.notifications[h.data.notifications.length - 1].id + '.e4']);
});

test('T19f [All] Mail sender: every other answer stops the sender, nothing more is published, and the next call tries that notification again', async () => {
  const f = start();
  f.event(ALLOCATION);
  f.event(proposed(ny('02', '08:10:00'), 'proto-subj-v3'));
  const [a, b] = f.data.notifications.slice(-2).map(n => n.id);
  const answers = [
    ['idempotency_conflict', {status: 'rejected', code: 'idempotency_conflict'}],
    ['an identity that the router refuses', {status: 'rejected', code: 'source_identity_mismatch'}],
    ['a refusal with stop_run', {status: 'rejected', code: 'receiver_rejected', stop_run: true}],
    ['a refusal for lack of a route with stop_run', {status: 'rejected', code: 'recipient_unavailable', stop_run: true}],
    ['unknown', {status: 'unknown', code: 'receiver_unconfirmed', stop_run: true}],
    ['halted', {status: 'halted', code: 'run_halted'}],
    ['a router that throws', new Error('The router does not answer.'), {status: 'unknown', code: 'router_unreachable'}],
    ['a router that returns no receipt', 'no receipt', {status: 'unknown', code: 'router_unreachable'}]
  ];
  for (const [label, answer, shown = answer] of answers) {
    const w = senderWorld(lifecycle(2, f), [answer]), sender = w.sender(), out = await sender.publishPending();
    assert.deepEqual([out.stopped, out.results, w.published.length], [true, [undelivered(a, shown)], 1], label);
    const again = await sender.publishPending();
    assert.deepEqual([again.stopped, again.results], [false, [delivered(a, a, 1), delivered(b, b, 2)]], label);
  }
  const w = senderWorld(null);
  await assert.rejects(w.sender().publishPending(), /env\.snapshot returned permission_denied/);
  assert.deepEqual([w.reads, w.published], [['env.snapshot'], []]);
});

test('T20 [All] Core contracts: tests/mcp.integration.cjs passes on the real runtime (task seed and clock, env.advance_time, replay, idempotency_conflict, stale_version, permission_denied, reset)',
  ...withRuntime('tests/mcp.integration.cjs'));

test('T20b [All] platform clock: with advance() and no App code a job reads running and then ended, a version expired, and a notice appears; the business data does not change', () => {
  const f = start();
  f.advance(ny('02'));
  const {id} = f.call('jobs.submit', SUBMIT);
  f.event(proposed(ny('02', '09:05:00'), 'proto-subj-v3'));
  const before = f.data;
  const read = () => [f.call('jobs.get', {id}).job.state, f.call('protocols.get', {id: 'proto-subj-v3'}).protocol.state, f.call('notifications.list').items.some(n => n.object_id === id),
    usage(f).reserved];
  assert.deepEqual(read(), ['queued', 'proposed', false, 108]);
  f.advance(ny('02', '10:00:00'));
  assert.deepEqual(read(), ['running', 'proposed', false, 108]);
  f.advance(ny('02', '19:30:00'));
  assert.deepEqual(read(), ['completed', 'proposed', true, 60]);
  f.advance(ny('07', '09:05:00'));
  assert.deepEqual(read(), ['completed', 'expired', true, 60]);
  assert.deepEqual(f.data, before);
  // Writes and events use the same clock: an ended job cannot be cancelled, and an expired version cannot be signed.
  unchanged(f, () => f.call('jobs.cancel', {id}), 'invalid_state');
  unchanged(f, () => f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'sign'}), 'invalid_state');
});

test('T20c [All] records: one activity row for each committed write, each applied event and each effect, and none for a refused call, a read or a change of time', () => {
  const f = start(), [q1, q2] = queuedPair(f), first = SEED.activity[SEED.activity.length - 1].seq + 1, expected = [];
  const ntf = () => 'ntf-' + String(f.data.notifications.length + 1).padStart(4, '0');
  const rows = (actor, ref, list) => list.forEach(([action, object_id, effect = false]) => expected.push({seq: first + expected.length, at: f.ctx.virtual_now,
    actor, action, object_id, request_id: actor === 'agent' ? ref : null, event_id: actor === 'event' ? ref : null, effect}));
  const write = (name, args, list) => { const request_id = 'rq-' + (expected.length + 1); const before = ntf(); const out = f.call(name, {...args, request_id});
    rows('agent', request_id, list(out, before)); return out; };
  const apply = (e, list) => { const before = ntf(); f.event(e); rows('event', e.event_id, list(before)); };
  const E = true;
  write('preferences.update', {job_end_notices: true}, () => [['preferences.update', ACCOUNT]]);
  f.advance(ny('02'));
  const job = write('jobs.submit', SUBMIT, (out, n) => [['jobs.submit', out.id], ['notification.written', n, E]]);
  write('jobs.hold', {id: job.id}, () => [['jobs.hold', job.id], ['notification.removed', 'ntf-0016', E]]);
  write('jobs.release', {id: job.id}, (out, n) => [['jobs.release', job.id], ['notification.written', n, E]]);
  apply(recorded(ny('02', '09:10:00'), 'job-0300', {starts_at: ny('02', '09:20:00'), ends_at: ny('02', '18:00:00')}), () => [['job.recorded', 'job-0300']]);
  apply(event('config.registered', ny('02', '09:11:00'), {config_id: 'cfg-new-v1', family: 'new', version: 1, params: {}, dataset_version: 'd', eval_split: 's', code_ref: 'x', registered_by: 'person-mei'}), () => [['config.registered', 'cfg-new-v1']]);
  apply(planSet(ny('02', '09:12:00'), 'cfg-mae-b16-v3', {seed: 0}), () => [['plan.set', 'rp-0014'], ['job.planned', q1, E], ['notification.written', 'ntf-0018', E]]);
  apply(event('job.interrupted', ny('02', '09:13:00'), {job_id: q1}), n => [['job.interrupted', q1], ['notification.removed', 'ntf-0018', E], ['notification.written', n, E]]);
  write('jobs.cancel', {id: job.id}, () => [['jobs.cancel', job.id], ['notification.removed', 'ntf-0017', E]]);
  apply(script(ny('02', '09:20:00'), {gpus: 8, time_limit_hours: 24}), n => [['job.script_submitted', 'cfg-birch-abl-v1'], ['notification.written', n, E]]);
  apply(event('allocation.changed', ny('02', '09:21:00'), {allocation_hours: 100, changed_by: 'person-okafor'}),
    n => [['allocation.changed', 'alloc-2026-12'], ['job.held', q2, E], ['notification.written', n, E]]);
  apply(proposed(ny('02', '09:22:00'), 'proto-subj-v3'), n => [['protocol.proposed', 'proto-subj-v3'], ['notification.written', n, E]]);
  write('protocols.respond', {id: 'proto-subj-v3', answer: 'sign'}, () => [['protocols.respond', 'proto-subj-v3']]);
  apply(answered(ny('02', '09:23:00'), 'proto-subj-v3', 'person-okafor'), n => [['protocol.answered', 'proto-subj-v3'], ['protocol.superseded', 'proto-subj-v2', E], ['notification.written', n, E]]);
  write('protocols.propose', {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2, 3]},
    out => [['protocols.propose', out.id]]);
  write('protocols.withdraw', {id: 'proto-subj-v4'}, () => [['protocols.withdraw', 'proto-subj-v4']]);
  apply(proposed(ny('02', '09:24:00'), 'proto-subj-v5'), n => [['protocol.proposed', 'proto-subj-v5'], ['notification.written', n, E]]);
  apply(event('protocol.withdrawn', ny('02', '09:25:00'), {protocol_id: 'proto-subj-v5'}), n => [['protocol.withdrawn', 'proto-subj-v5'], ['notification.written', n, E]]);
  const result = mine(f, 'completed').find(j => j.config_id === 'cfg-vit-s16-v2').id;
  write('results.update', {id: result, tags: ['x']}, () => [['results.update', result]]);
  const t = write('tables.create', {id: 'proto-subj-v2', title: 'T'}, out => [['tables.create', out.id]]);
  write('tables.update', {id: t.id, rows: ROWS(f)}, () => [['tables.update', t.id]]);
  write('tables.freeze', {id: t.id}, () => [['tables.freeze', t.id]]);
  const v2 = write('tables.revise', {id: t.id}, out => [['tables.revise', out.id]]);
  write('tables.freeze', {id: v2.id}, () => [['tables.freeze', v2.id], ['table.superseded', t.id, E]]);
  const v3 = write('tables.revise', {id: v2.id}, out => [['tables.revise', out.id]]);
  write('tables.discard', {id: v3.id}, () => [['tables.discard', v3.id]]);
  apply(event('result.invalidated', ny('02', '09:30:00'), {job_id: 'job-0101', invalidated_by: 'person-mei'}), n => [['result.invalidated', 'job-0101'], ['notification.written', n, E]]);
  // A refused write, a rejected event, every read and a change of time write no row.
  unchanged(f, () => f.call('jobs.cancel', {id: job.id}), 'invalid_state');
  unchanged(f, () => f.event(event('job.interrupted', ny('02', '09:40:00'), {job_id: job.id})), 'invalid_event');
  for (const name of ['project.get', 'usage.summary', 'configs.list', 'jobs.list', 'results.list', 'protocols.list', 'tables.list', 'notifications.list', 'preferences.get']) f.call(name);
  f.advance(ny('05'));
  assert.deepEqual(f.data.activity.slice(SEED.activity.length), expected);
  const actions = actor => [...new Set(expected.filter(row => row.actor === actor && !row.effect).map(row => row.action))].sort();
  assert.deepEqual([actions('agent'), actions('event')], [[...WRITES].sort(), [...EVENTS].sort()]);
  assert.deepEqual([...new Set(expected.filter(row => row.effect).map(row => row.action))].sort(),
    ['job.held', 'job.planned', 'notification.removed', 'notification.written', 'protocol.superseded', 'table.superseded']);
  // Each write and each event has exactly one row that is not an effect.
  for (const key of ['request_id', 'event_id']) {
    for (const ref of new Set(expected.filter(row => row[key]).map(row => row[key]))) assert.equal(f.data.activity.filter(row => row[key] === ref && !row.effect).length, 1, ref);
  }
  // The changes of the target are in its own history.
  assert.deepEqual(f.data.jobs.find(j => j.id === job.id).history.map(h => [h.action, h.state]), [['jobs.submit', 'queued'], ['jobs.hold', 'held'], ['jobs.release', 'queued'], ['jobs.cancel', 'cancelled']]);
});

test('T20d [All] the error table: each of the 23 App errors, and the first one of the table when two fit one call', () => {
  const seen = new Set(), f = start();
  const check = (g, fn, code, label) => { unchanged(g, fn, code, label); seen.add(code); };
  const [q1] = queuedPair(f);
  check(f, () => f.call('jobs.cancel', {id: 'job-none'}), 'not_found', 'unknown job');
  check(f, () => f.call('jobs.cancel', {id: 'job-0101'}), 'not_yours', 'not_yours before invalid_state: an ended job of a labmate');
  const noSigner = fixture({seed: withPolicy(p => { p.required_signers = ['person-okafor']; }), now: NOW});
  noSigner.event(proposed(ny('02', '07:10:00'), 'proto-subj-v3'));
  noSigner.advance(ny('08'));
  check(noSigner, () => noSigner.call('protocols.respond', {id: 'proto-subj-v3', answer: 'sign'}), 'not_a_signer', 'not_a_signer before invalid_state: an expired version');
  check(f, () => f.call('jobs.release', {id: q1}), 'invalid_state', 'a queued job');
  check(f, () => f.call('results.list', {start: '2026-12-02', end: '2026-12-01'}), 'invalid_window', 'window');
  check(f, () => f.call('preferences.update', {timezone: 'Nowhere/City'}), 'invalid_timezone', 'zone');
  const hard = fixture({seed: withPolicy(p => { p.hard_shares = true; }), now: NOW});
  check(hard, () => hard.call('jobs.submit', {...SUBMIT, seed: 7, time_limit_hours: 30, gpus: 8}), 'time_limit_too_long', 'time_limit_too_long before protocol_mismatch and the hours');
  check(hard, () => hard.call('jobs.submit', {...SUBMIT, seed: 7, gpus: 8}), 'protocol_mismatch', 'protocol_mismatch before the hours');
  check(hard, () => hard.call('jobs.submit', {...SUBMIT, gpus: 8}), 'over_allocation', 'over_allocation before over_share');
  check(hard, () => hard.call('jobs.submit', {...SUBMIT, time_limit_hours: 15}), 'over_share', 'share');
  hard.call('jobs.submit', {...SUBMIT, partition_id: 'cpu'});
  check(hard, () => hard.call('jobs.submit', {...SUBMIT, gpus: 8}), 'too_many_active', 'too_many_active before over_allocation');
  f.event(proposed(ny('02', '07:10:00'), 'proto-subj-v3'));
  const spec = {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2]};
  check(f, () => f.call('protocols.propose', spec), 'already_proposed', 'already_proposed before no_change');
  f.call('protocols.respond', {id: 'proto-subj-v3', answer: 'decline'});
  check(f, () => f.call('protocols.propose', spec), 'no_change', 'same as signed');
  const mineProto = f.call('protocols.propose', {...spec, seeds: [0, 1, 2, 3]}).id;
  check(f, () => f.call('protocols.respond', {id: mineProto, answer: 'decline'}), 'already_answered', 'own signature');
  check(f, () => f.call('results.update', {id: q1, disposition: 'excluded'}), 'not_completed', 'not_completed before reason_required');
  const done = ROWS(f)[1].result_ids[0];
  check(f, () => f.call('results.update', {id: done, disposition: 'excluded'}), 'reason_required', 'reason');
  const t = f.call('tables.create', {id: 'proto-subj-v2', title: 'T'}).id;
  const v1 = f.call('jobs.list', {protocol_id: 'proto-subj-v1'}).items.find(j => j.has_result).id;
  check(f, () => f.call('tables.update', {id: t, rows: [{name: 'A', result_ids: [q1, v1]}]}), 'not_completed', 'not_completed before mixed_protocols');
  check(f, () => f.call('tables.update', {id: t, rows: [{name: 'A', result_ids: [v1, v1]}]}), 'mixed_protocols', 'mixed_protocols before duplicate_result');
  check(f, () => f.call('tables.update', {id: t, rows: [{name: 'A', result_ids: ['job-0101', 'job-0101']}]}), 'duplicate_result', 'twice');
  check(f, () => f.call('tables.freeze', {id: t}), 'empty_table', 'empty');
  const u = f.call('tables.create', {id: mineProto, title: 'U'}).id;
  f.call('tables.update', {id: u, rows: [{name: 'Two', result_ids: []}].slice(1)});
  f.event(recorded(ny('02', '07:20:00'), 'job-0400', {protocol_id: mineProto, seed: 3}));
  f.call('tables.update', {id: u, rows: [{name: 'One', result_ids: ['job-0400']}]});
  check(f, () => f.call('tables.freeze', {id: u}), 'protocol_not_signed', 'protocol_not_signed before incomplete_seeds');
  f.call('tables.update', {id: t, rows: [{name: 'Two', result_ids: ['job-0101', 'job-0102']}]});
  f.call('results.update', {id: done, disposition: 'excluded', reason: 'Bad node.'});
  f.call('tables.update', {id: t, rows: [{name: 'Two', result_ids: ['job-0101', 'job-0102']}, ROWS(f)[1]]});
  check(f, () => f.call('tables.freeze', {id: t}), 'incomplete_seeds', 'incomplete_seeds before cites_excluded');
  f.event(event('result.invalidated', ny('02', '07:30:00'), {job_id: ROWS(f)[1].result_ids[1], invalidated_by: 'person-mei'}));
  f.call('tables.update', {id: t, rows: [ROWS(f)[1]]});
  check(f, () => f.call('tables.freeze', {id: t}), 'cites_excluded', 'cites_excluded before cites_invalidated');
  f.call('results.update', {id: done, disposition: 'candidate'});
  check(f, () => f.call('tables.freeze', {id: t}), 'cites_invalidated', 'invalidated');
  assert.deepEqual(ERRORS.filter(code => !seen.has(code)), []);
});

test('T21 [All] seed rules: validateSeed rejects each seed of the plan\'s list, and each seed that breaks a rule that the package adds, with invalid_seed', () => {
  const ctx = (now = NOW) => Object.freeze({app_id: 'benchline', role: 'agent', virtual_now: now, binding: require('../fixtures/binding.json')});
  const ok = data => plugin.validateSeed(ctx(), data);
  ok(SEED);
  const rejects = (label, change, now) => assert.throws(() => plugin.validateSeed(ctx(now), edit(SEED, change)), e => e.code === 'invalid_seed', label);
  const job = (data, id) => data.jobs.find(j => j.id === id);
  // The plan's list.
  rejects('a duplicate ID', d => { d.jobs[1].id = d.jobs[0].id; });
  rejects('a reference to an object that does not exist', d => { d.jobs[0].config_id = 'cfg-none'; });
  rejects('a timestamp without a UTC offset', d => { d.jobs[0].submitted_at = '2026-11-03T09:00:00'; });
  rejects('an account that the binding does not declare', d => { d.account_id = 'benchline-other'; });
  rejects('a job that ends before it starts', d => { const j = job(d, 'job-0101'); j.run.ends_at = '2026-12-01T07:00:00-05:00'; });
  rejects('a job that runs longer than its time limit', d => { job(d, 'job-0101').time_limit_hours = 10; });
  rejects('a job whose seed its protocol version does not cover', d => { job(d, 'job-0101').seed = 9; });
  rejects('a job whose config its protocol version does not cover', d => { job(d, 'job-0101').config_id = 'cfg-vit-s16-v1'; });
  rejects('an empty required_signers list', d => { d.project.policy.required_signers = []; });
  rejects('two versions on one line that are both proposed and not yet expired', d => {
    d.protocols.push(edit(d.protocols[1], p => Object.assign(p, {id: 'proto-subj-v3', version: 3, stored_state: 'proposed', signed_at: null, supersedes: null, respond_by: ny('09')})));
    d.protocols.push(edit(d.protocols[1], p => Object.assign(p, {id: 'proto-subj-v4', version: 4, stored_state: 'proposed', signed_at: null, supersedes: null, respond_by: ny('09')})));
  });
  // Both are expired at the seed's time, so the line can take a new proposal: valid.
  plugin.validateSeed(ctx(ny('10')), edit(SEED, d => {
    for (const v of [3, 4]) d.protocols.push(edit(d.protocols[1], p => Object.assign(p, {id: 'proto-subj-v' + v, version: v, stored_state: 'proposed', signed_at: null, supersedes: null, respond_by: ny('09')})));
  }));
  const f = start(), id = f.call('tables.create', {id: 'proto-subj-v2', title: 'T'}).id;
  f.call('tables.update', {id, rows: ROWS(f)});
  f.call('tables.freeze', {id});
  const withTable = f.data;
  ok(withTable);
  const tableRejects = (label, change) => assert.throws(() => plugin.validateSeed(ctx(), edit(withTable, change)), e => e.code === 'invalid_seed', label);
  tableRejects('two draft versions of one table', d => { d.tables.push(edit(d.tables[0], t => Object.assign(t, {id: 'tbl-0001.v2', version: 2, stored_state: 'draft', frozen_at: null, manifest: null}))); d.tables.push(edit(d.tables[1], t => Object.assign(t, {id: 'tbl-0001.v3', version: 3}))); });
  tableRejects('a frozen table whose manifest does not match its results', d => { d.tables[0].manifest.rows[0].metrics.accuracy.mean = 0.8; });
  tableRejects('a frozen table whose hash does not match', d => { d.tables[0].manifest.title = 'Other'; });
  tableRejects('a frozen table that cites another result than its rows', d => { d.tables[0].rows[0].result_ids[0] = 'job-0104'; });
  // Rules that the package adds, so that every record stays readable.
  rejects('a protocol version with a seed twice', d => { d.protocols[1].seeds = [0, 0, 1]; });
  rejects('a held job with a run', d => { const j = job(d, queuedPair(start())[0]); Object.assign(j, {stored_state: 'held', hold_reason: 'agent'}); j.run = job(d, 'job-0101').run; });
  rejects('a cancelled job with no cancel time', d => { job(d, queuedPair(start())[0]).stored_state = 'cancelled'; });
  rejects('a review of a job with no result', d => { job(d, queuedPair(start())[0]).review = {tags: [], note: null, excluded: false, reason: null, updated_at: NOW}; });
  rejects('an excluded result with no reason', d => { job(d, 'job-0101').review = {tags: [], note: null, excluded: true, reason: null, updated_at: NOW}; });
  rejects('a job of the account holder marked as recorded', d => { d.jobs.find(j => j.owner_person_id === OWNER).submitted_by = 'labmate'; });
  rejects('a labmate\'s job from a script', d => { Object.assign(job(d, 'job-0101'), {submitted_by: 'script', script: 'x.sh'}); });
  rejects('a metric with a bad name', d => { job(d, 'job-0101').run.metrics = {'Top 1': 0.7}; });
  rejects('an hour value with three decimals', d => { d.allocation.allocation_hours = 400.125; });
  rejects('an unknown required signer', d => { d.project.policy.required_signers.push('person-zed'); });
  rejects('an unknown lab head', d => { d.project.lab_head_person_id = 'person-zed'; });
  rejects('a protocol state that does not fit its times', d => { d.protocols[1].signed_at = null; });
  rejects('a line with two signed versions', d => { Object.assign(d.protocols[0], {stored_state: 'signed', superseded_at: null, superseded_by: null}); });
  rejects('two run plans for one key', d => { d.run_plans.push({...d.run_plans[0], id: 'rp-9999'}); });
  rejects('a notification about an object that does not exist', d => { d.notifications[0].object_id = 'job-none'; });
  rejects('activity rows out of order', d => { d.activity[1].seq = d.activity[0].seq; });
  rejects('an unknown time zone', d => { d.project.timezone = 'Mars/Base'; });
  rejects('an allocation period that ends before it starts', d => { d.allocation.ends_at = '2026-11-01T00:00:00-04:00'; });
});

test('T21b [All] seed rules never make a valid write or event fail: a fixed walk of writes, events and clock moves commits each valid step', () => {
  // A fixed pseudo-random walk from the task seed. Each step that the App accepts must leave a seed that passes validateSeed (the harness checks it).
  let a = 20261202;
  const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = list => list[Math.floor(rand() * list.length)];
  const f = start(), configs = ['cfg-mae-b16-v3', 'cfg-vit-s16-v2', 'cfg-mae-b16-v2', 'cfg-atlas-v2', 'cfg-birch-abl-v1'];
  let committed = 0, refused = 0, clock = Date.parse(NOW), n = 0;
  const later = minutes => { clock += minutes * 60000; return new Date(clock).toISOString().replace('.000Z', 'Z'); };
  for (let step = 0; step < 300; step++) {
    const jobs = f.data.jobs, choice = rand(), at = later(Math.floor(rand() * 180));
    const steps = [
      () => f.call('jobs.submit', {id: pick(configs), seed: Math.floor(rand() * 4), partition_id: pick(['gpu-h', 'gpu-a', 'cpu']), gpus: 1 + Math.floor(rand() * 3),
        time_limit_hours: pick([2, 6, 12]), protocol_id: pick([null, 'proto-subj-v2']), hold: rand() < 0.3}),
      () => f.call(pick(['jobs.hold', 'jobs.release', 'jobs.cancel']), {id: pick(jobs).id}),
      () => f.call('results.update', {id: pick(jobs).id, disposition: pick(['excluded', 'candidate']), reason: 'Walk.'}),
      () => f.event(event('job.script_submitted', at, {script: 'walk.sh', config_id: pick(configs), seed: Math.floor(rand() * 3), partition_id: 'gpu-a', gpus: 1, time_limit_hours: 6, hold: rand() < 0.5})),
      () => f.event(event('allocation.changed', at, {allocation_hours: pick([100, 250, 400, 600]), shares: [{person_id: OWNER, share_hours: pick([null, 40, 150])}], changed_by: 'person-okafor'})),
      () => f.event(planSet(at, pick(configs), {seed: pick([null, 0, 1]), queue_wait_minutes: Math.floor(rand() * 120), run_minutes: pick([60, 300, 900])})),
      () => f.event(event('job.interrupted', at, {job_id: pick(jobs).id})),
      () => f.event(event('result.invalidated', at, {job_id: pick(jobs).id, invalidated_by: 'person-mei'})),
      () => f.event(recorded(at, 'job-w' + (++n), {starts_at: at, ends_at: at})),
      () => f.event(proposed(at, 'proto-w' + (++n), {seeds: [0, 1, 2, 3].slice(0, 1 + Math.floor(rand() * 4)), eval_split: pick(['test-subjects', 'test-trials'])})),
      () => f.call('protocols.respond', {id: pick(f.data.protocols).id, answer: pick(['sign', 'decline'])}),
      () => f.event(answered(at, pick(f.data.protocols).id, 'person-okafor', pick(['sign', 'decline']))),
      () => f.call('protocols.propose', {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: pick(['test-subjects', 'test-trials']), metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2, 3].slice(0, 1 + Math.floor(rand() * 4))}),
      () => f.call('tables.create', {id: pick(f.data.protocols).id, title: 'Walk'}),
      () => { const t = pick(f.data.tables); return t && f.call('tables.update', {id: t.id, rows: [{name: 'R', result_ids: f.data.jobs.filter(j => j.protocol_id === t.protocol_id).slice(0, 3).map(j => j.id)}]}); },
      () => { const t = pick(f.data.tables); return t && f.call(pick(['tables.freeze', 'tables.revise', 'tables.discard']), {id: t.id}); },
      () => f.advance(at)
    ];
    try { steps[Math.floor(choice * steps.length)](); committed++; }
    catch (error) {
      // An App error or an input-schema refusal is fine. A refusal of the harness's seed check is the failure that this test looks for.
      assert.ok(error.code && error.code !== 'invalid_seed' && !/Seed schema|Output schema/.test(error.message) || error.message.startsWith(SCHEMA), 'step ' + step + ': ' + error.message);
      refused++;
    }
  }
  assert.ok(committed > 150 && refused > 20, committed + ' committed, ' + refused + ' refused');
});

// T22 to T22c answer the design review at approval: "keep scheduled submissions on the same quota/share checks as manual submissions, and show that a held
// submission consumes no allocation until release reruns the full checks." A scheduled submission is the job.script_submitted event of the researcher's script.
const asScript = (at, args) => script(at, {config_id: args.id, seed: args.seed, partition_id: args.partition_id, gpus: args.gpus, time_limit_hours: args.time_limit_hours,
  protocol_id: args.protocol_id ?? null, hold: args.hold === true});
// The job that a submission adds, without the fields that name who submitted it and how.
const added = (f, before) => f.data.jobs.slice(before).map(({id, submitted_by, script: name, request_id, event_id, history, ...rest}) => rest);
const rejected = f => f.data.notifications.filter(n => n.kind === 'job.submission_rejected').map(n => n.details.error);

test('T22 [W2] scheduled submissions: job.script_submitted runs the same submission check as jobs.submit, with the same job on a pass and the same error on each failing step', () => {
  const at = ny('02', '22:00:00');
  // Hard shares, so every step of the check can fail. Nadia has 54 GPU-hours left of her share, and the project 128.
  const policy = withPolicy(p => { p.hard_shares = true; });
  const cases = [
    ['a pass', {...SUBMIT}, null],
    ['a pass in the held state', {...SUBMIT, gpus: 8, hold: true}, null],
    ['time_limit_too_long', {...SUBMIT, time_limit_hours: 30}, 'time_limit_too_long'],
    ['protocol_mismatch', {...SUBMIT, seed: 7}, 'protocol_mismatch'],
    ['over_allocation', {...SUBMIT, gpus: 8}, 'over_allocation'],
    ['over_share', {...SUBMIT, time_limit_hours: 15}, 'over_share'],
    ['too_many_active', {...SUBMIT, seed: 1}, 'too_many_active', true]
  ];
  for (const [label, args, error, third] of cases) {
    const manual = fixture({seed: policy, now: NOW}), scheduled = fixture({seed: policy, now: NOW});
    // For the job count, a third job with no run plan first fills the limit of 3 on both sides.
    if (third) for (const f of [manual, scheduled]) f.call('jobs.submit', {...SUBMIT, seed: 0, partition_id: 'cpu'});
    manual.advance(at);
    const jobs = manual.data.jobs.length;
    if (error) unchanged(manual, () => manual.call('jobs.submit', args), error, label);
    else manual.call('jobs.submit', args);
    scheduled.event(asScript(at, args));
    assert.deepEqual(added(scheduled, jobs), added(manual, jobs), label + ': the same job, or none');
    assert.deepEqual(rejected(scheduled), error ? [error] : [], label + ': the error of the notification');
    assert.deepEqual(usage(scheduled), usage(manual), label + ': the same usage');
    if (!error) assert.deepEqual([scheduled.data.jobs[jobs].submitted_by, scheduled.data.jobs[jobs].script], ['script', 'birch-ablations.sh']);
  }
  // With soft shares a script job over the share is added with the flag over_share, as a manual one is.
  const soft = start(), hand = start();
  for (const f of [soft, hand]) f.advance(ny('02', '21:59:00'));
  hand.call('jobs.submit', {...SUBMIT, time_limit_hours: 15});
  soft.event(asScript(ny('02', '21:59:00'), {...SUBMIT, time_limit_hours: 15}));
  assert.deepEqual(mine(soft, 'queued').map(j => j.flags), mine(hand, 'queued').map(j => j.flags));
  assert.deepEqual(mine(soft, 'queued').pop().flags, ['over_share']);
  // W2 of the plan: with hard shares and 6 GPU-hours left of the share, the 22:00 script job of 48 is not added, and one notice names over_share.
  // Four active jobs are allowed here, so the job count does not stop the script first.
  const w2 = fixture({seed: withPolicy(p => { p.hard_shares = true; p.max_active_jobs = 4; }), now: NOW});
  w2.advance(ny('02', '21:30:00'));
  w2.call('jobs.submit', SUBMIT);
  assert.equal(share(w2).remaining, 6);
  w2.event(PLAN['ev-bl-212']);
  const notice = w2.data.notifications[w2.data.notifications.length - 1];
  assert.deepEqual([notice.kind, notice.object_id, notice.details.error], ['job.submission_rejected', 'cfg-birch-abl-v1', 'over_share']);
  assert.ok(notice.text.includes('your share has 6 GPU-hours left, and the job needs 48 (over_share)'), notice.text);
  assert.equal(mine(w2).length, mine(fixture({seed: policy, now: NOW})).length + 1);
});

test('T22b [W2] held submissions: hold: true consumes no allocation, the usage summary does not change, and jobs.release reruns all six steps, failing on over_allocation and over_share until the hours are back', () => {
  const f = fixture({seed: withPolicy(p => { p.hard_shares = true; }), now: NOW});
  f.advance(ny('02'));
  const before = JSON.stringify(usage(f));
  // Held, the first four steps still run: seed 7 is not in the protocol, and 30 hours are too long.
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, seed: 7, hold: true}), 'protocol_mismatch', 'a held job under a protocol that does not cover it');
  unchanged(f, () => f.call('jobs.submit', {...SUBMIT, time_limit_hours: 30, hold: true}), 'time_limit_too_long', 'a held job over the longest job time');
  // 4 GPUs for 12 hours on gpu-h would reserve 96: more than the 54 left of the share. Held, the check skips the hours.
  const held = f.call('jobs.submit', {...SUBMIT, gpus: 4, hold: true});
  assert.deepEqual([held.state, held.hold_reason, held.reserved_hours], ['held', 'submitted_held', 0]);
  assert.equal(JSON.stringify(usage(f)), before, 'the usage summary is byte-identical');
  f.advance(ny('03'));
  assert.equal(JSON.stringify(usage(f)), before, 'a held job never starts and is never charged');
  assert.deepEqual(f.call('jobs.get', {id: held.id}).job.starts_at, null);
  unchanged(f, () => f.call('jobs.release', {id: held.id}), 'over_share', 'release runs the share step');
  // A cut of the allocation: the project has too little left, and over_allocation comes first.
  f.event(event('allocation.changed', ny('03', '09:10:00'), {allocation_hours: 250, changed_by: 'person-okafor'}));
  unchanged(f, () => f.call('jobs.release', {id: held.id}), 'over_allocation', 'release runs the allocation step');
  assert.equal(f.call('jobs.get', {id: held.id}).job.hold_reason, 'submitted_held');
  // Once the hours are back the release passes, reserves 96 and the job waits in the queue from now.
  f.event(event('allocation.changed', ny('03', '09:20:00'), {allocation_hours: 500, shares: [{person_id: OWNER, share_hours: 300}], changed_by: 'person-okafor'}));
  const out = f.call('jobs.release', {id: held.id});
  assert.deepEqual([out.state, out.reserved_hours], ['queued', 96]);
  // The cut to 250 held one of Nadia's two queued jobs (the last submitted, 30 GPU-hours), so 30 + 96 are reserved.
  assert.deepEqual([usage(f).reserved, share(f).reserved], [126, 126]);
  // The held job is one of the three active jobs, and release does not count it against itself (T06 releases with 3 active).
  assert.equal(mine(f).filter(j => ['queued', 'held', 'running'].includes(j.state)).length, 3);
});

test('T22c [W2] Task #257 (Atlas first, Birch with what is left): with a hard share, three Birch ablations queued and one held leave room for the 22:00 Atlas script job; four queued make the script fail with over_share', () => {
  const seed = withPolicy(p => { p.hard_shares = true; p.max_active_jobs = 6; });
  const birch = [['cfg-birch-abl-v1', 0], ['cfg-birch-abl-v2', 0], ['cfg-birch-abl-v3', 0], ['cfg-birch-abl-v1', 1]].map(([id, s]) => ({id, seed: s, partition_id: 'gpu-a', gpus: 1, time_limit_hours: 12, protocol_id: null}));
  const atlas = {script: 'atlas-sweep.sh', config_id: 'cfg-atlas-v2', seed: 1, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 18, protocol_id: 'proto-subj-v2'};
  const run = holdLast => {
    const f = fixture({seed, now: NOW});
    for (const id of queuedPair(f)) f.call('jobs.cancel', {id});
    f.event(planSet(ny('02', '19:00:00'), 'cfg-atlas-v2', {seed: 1, queue_wait_minutes: 10, run_minutes: 600, metrics: {accuracy: 0.734}}));
    f.advance(ny('02', '20:00:00'));
    assert.equal(share(f).remaining, 114);
    // jobs.estimate allows all four: the cluster check does not know the Atlas sweep that Nadia announced.
    assert.deepEqual(birch.map(b => f.call('jobs.estimate', b).estimate.allowed), [true, true, true, true]);
    birch.forEach((b, i) => f.call('jobs.submit', {...b, hold: holdLast && i === 3}));
    f.event(event('job.script_submitted', ny('02', '22:00:00'), atlas));
    return f;
  };
  const right = run(true);
  assert.deepEqual(mine(right).filter(j => j.submitted_at >= ny('02', '20:00:00')).map(j => [j.config_id, j.state, j.submitted_by]),
    [['cfg-birch-abl-v1', 'running', 'agent'], ['cfg-birch-abl-v2', 'running', 'agent'], ['cfg-birch-abl-v3', 'running', 'agent'], ['cfg-birch-abl-v1', 'held', 'agent'],
      ['cfg-atlas-v2', 'queued', 'script']]);
  assert.deepEqual(rejected(right), []);
  // The next morning the Atlas job has ended and its reservation is back, so the held ablation is released.
  right.advance(ny('03', '08:30:00'));
  const held = mine(right, 'held')[0];
  assert.equal(right.call('jobs.release', {id: held.id}).state, 'queued');
  const atlasJob = mine(right, 'completed').find(j => j.config_id === 'cfg-atlas-v2');
  assert.deepEqual([atlasJob.charged_hours, right.call('jobs.get', {id: atlasJob.id}).result.metrics.accuracy], [40, 0.734]);
  // The counterfactual: all four queued at 20:00, and the Atlas script job does not fit the share at 22:00.
  const wrong = run(false);
  assert.deepEqual(rejected(wrong), ['over_share']);
  assert.ok(!mine(wrong).some(j => j.config_id === 'cfg-atlas-v2'));
});

// T23: the delivery dataset in data/evaluation/ (plan section 4). The month-start seeds come from one replay pass. The three --check
// scripts run in child processes while that pass runs, so the block stays well under the time limit of the file.
{
  const {spawn} = require('node:child_process');
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(ROOT, 'schemas'));
  const generator = require('../dev/generate-dataset.cjs');
  const {problems, RULES} = require('../dev/check-evaluation.cjs');
  const {select, later} = require('../dev/select-evaluation-seed.cjs');
  const {consistency} = require('../dev/check-fixture.cjs');
  const coverage = require('../dev/coverage.cjs');
  const evaluation = file => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evaluation', file), 'utf8'));
  const ctx23 = at => Object.freeze({app_id: 'benchline', role: 'agent', virtual_now: at, binding: require('../fixtures/binding.json')});
  const CHECKS = [['dev/generate-dataset.cjs', '--check'], ['dev/coverage.cjs', '--check'], ['dev/select-evaluation-seed.cjs', '--check']];
  let running = null;
  const checks = () => running || (running = Promise.all(CHECKS.map(args => new Promise(resolve => {
    const child = spawn(process.execPath, args, {cwd: ROOT});
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('close', code => resolve({args: args.join(' '), code, out}));
  }))));
  // Times for the selector checks: the month starts, a time after each interruption (before the planned end of the job), the time of the second
  // review, and 30 fixed random times across the window.
  const delivered = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evaluation/seed.json'), 'utf8'));
  const afterFailures = delivered.jobs.filter(j => j.stored_state === 'interrupted').map(j => new Date(Date.parse(j.interrupted_at) + 3600000).toISOString().replace('.000Z', 'Z'));
  let r = 20250101;
  const randomTimes = Array.from({length: 30}, () => { r = (r * 1103515245 + 12345) % 2147483648;
    return new Date(Date.parse(generator.START) + (r / 2147483648) * (Date.parse(generator.CLOCK) - Date.parse(generator.START))).toISOString().replace(/\.\d{3}Z$/, 'Z'); });
  const SELECT_TIMES = [...afterFailures, '2025-12-10T19:43:00-05:00', ...randomTimes];
  let pass = null;
  const onePass = () => pass || (pass = generator.generate({keepAt: [...generator.MONTH_STARTS, ...SELECT_TIMES]}));

  test('T23 [Data] the seeds at the 24 month starts, from one replay pass, pass validateSeed at their time, the consistency script and the story rules', () => {
    checks();
    const {seed, manifest, snapshots} = onePass();
    assert.equal(JSON.stringify(seed) + '\n', fs.readFileSync(path.join(ROOT, 'data/evaluation/seed.json'), 'utf8'), 'the pass gives the delivered seed');
    assert.equal(generator.MONTH_STARTS.length, 24);
    for (const at of generator.MONTH_STARTS) {
      const data = snapshots[at];
      assert.ok(seedValid(data), at + ': seed schema');
      plugin.validateSeed(ctx23(at), data);
      assert.deepEqual(consistency(data, at), [], at + ': consistency script');
      assert.deepEqual(problems(data, manifest, at), [], at + ': story rules');
      assert.equal(data.allocation.period_id, 'alloc-' + at.slice(0, 4) + '-q' + (Math.floor((Number(at.slice(5, 7)) - 1) / 3) + 1), at + ': the current period');
    }
    assert.deepEqual(problems(seed, manifest), [], 'story rules at the clock');
    const now = Date.parse(generator.CLOCK), views = require('../src/views.cjs');
    assert.deepEqual([new Set(seed.configs.map(c => c.family)).size, new Set(seed.protocols.map(p => p.line)).size, seed.past_periods.length + 1],
      [8, 6, 9], 'families, lines and periods (8 quarters of the window and Q4 2024)');
    assert.deepEqual([...new Set(seed.protocols.map(p => views.protocolState(p, now)))].sort(), ['declined', 'expired', 'proposed', 'signed', 'superseded', 'withdrawn']);
    assert.ok(seed.jobs.length > 1400 && seed.jobs.filter(j => j.owner_person_id === OWNER).length > 300 && seed.jobs.some(j => j.submitted_by === 'script'), 'jobs of the lab and of Nadia');
    // The allocation runs short once: the cut holds queued jobs of Nadia, a held one is released and others are cancelled.
    const acts = action => seed.jobs.filter(j => j.history.some(h => h.action === action)).length;
    assert.ok(acts('job.held') >= 2 && acts('jobs.release') >= 1 && seed.jobs.some(j => j.stored_state === 'cancelled'), 'holds, releases and cancellations');
    assert.ok(evaluation('manifest.json').skipped.every(x => x.reason !== 'not held'), 'skipped steps are listed with a reason');
    assert.ok(seed.tables.length >= 25 && seed.configs.length >= 40 && seed.protocols.length >= 20, 'at least 25 table versions, 40 configs and 20 versions');
    // No filler: a config never changes, so the same config and seed under the same evaluation (dataset, split, metrics; any version of a line)
    // run again only after a run that gave no usable result.
    const runs = new Map(), versions = new Map(seed.protocols.map(p => [p.id, p])), {evaluationKey} = require('../dev/check-evaluation.cjs');
    for (const j of seed.jobs) { const k = evaluationKey(j, versions); runs.set(k, (runs.get(k) || []).concat(j)); }
    const again = [...runs.values()].filter(list => list.length > 1);
    assert.ok(again.length > 50, 'reruns exist');
    for (const list of again) for (const j of list.slice(0, -1)) assert.ok(!(views.hasResult(j, now) && !j.invalidation), 'a usable run done again: ' + j.id);
    // The counts that the two READMEs state are the counts of the manifest.
    const c = evaluation('manifest.json').counts, n = x => x.toLocaleString('en-US');
    const mineScript = seed.jobs.filter(j => j.submitted_by === 'script').length, labmates = seed.jobs.filter(j => j.submitted_by === 'labmate').length;
    const sentence = n(c.jobs) + ' jobs (' + n(c.researcher_jobs) + ' of Nadia, ' + n(mineScript) + ' of them from her script; ' + n(labmates) + ' recorded for labmates), ' + n(c.configs) +
      ' configs in 8 families, ' + c.protocol_versions + ' protocol versions on 6 lines (in all six states), ' + c.table_versions + ' table versions, ' + n(c.run_plans) + ' run plans and ' +
      c.allocation_changes + ' allocation changes. That is ' + n(c.records) + ' records.';
    assert.ok(fs.readFileSync(path.join(ROOT, 'data/evaluation/README.md'), 'utf8').includes(sentence), 'data/evaluation/README.md: ' + sentence);
    const short = n(c.records) + ' records: ' + n(c.jobs) + ' jobs (' + n(c.researcher_jobs) + ' of the researcher, ' + n(mineScript) + ' of them from her script), ' + n(c.configs) +
      ' configs in 8 families, ' + c.protocol_versions + ' protocol versions on 6 lines in all six states, ' + c.table_versions + ' table versions, ' + n(c.run_plans) + ' run plans and ' +
      c.allocation_changes + ' allocation changes';
    assert.ok(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').includes(short), 'README.md: ' + short);
    const cov = evaluation('coverage.json').actual;
    assert.ok(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').includes('fall on ' + cov.global.distinct_dates + ' distinct dates'), 'README.md: the distinct dates');
  });

  test('T23b [Data] the generator, the coverage report and the selector pass --check on the committed files, and the hashes match', async () => {
    for (const r of await checks()) assert.equal(r.code, 0, r.args + '\n' + r.out);
    const manifest = evaluation('manifest.json');
    const declared = require('../contribution/dataset.json').sources.find(x => x.source_id === 'evaluation-generator').generation.parameters.files;
    for (const name of ['seed.json', 'clock.json', 'dataset.json']) {
      const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'data/evaluation', name))).digest('hex');
      assert.deepEqual([manifest.files[name].sha256, declared.find(f => f.name === 'data/evaluation/' + name).sha256], [sha, sha], name);
    }
    const dataset = evaluation('dataset.json');
    assert.deepEqual([dataset.record_source_ids, dataset.sources.map(x => x.kind), dataset.expected_counts.records], [['evaluation-generator'], ['synthetic'], plugin.records(evaluation('seed.json')).length]);
  });

  test('T23c [Data] the selector refuses a seed with a later timestamp and a time outside the window, and allows only planned times', () => {
    const {seed, snapshots} = onePass(), at = generator.MONTH_STARTS[17], mid = snapshots[at];
    assert.ok(later(seed, at).length > 0, 'control: the delivered seed has timestamps after ' + at);
    assert.deepEqual(later(mid, at), [], 'the month-start seed has no later timestamp');
    const planted = structuredClone(mid);
    planted.jobs[0].history.push({at: '2026-06-03T04:00:00-04:00', action: 'jobs.cancel', actor: 'agent', ref: 'later', state: 'cancelled'});
    planted.tables[0].created_at = '2026-06-02T09:00:00-04:00';
    assert.deepEqual(later(planted, at).map(x => x.path), ['jobs[0].history[' + (planted.jobs[0].history.length - 1) + '].at', 'tables[0].created_at']);
    // At every month start, after each node failure and at 30 random times, the seed of that time holds no later timestamp, except planned times.
    assert.ok(afterFailures.length >= 3, 'control: the dataset has node failures');
    for (const t of [...generator.MONTH_STARTS, ...SELECT_TIMES]) assert.deepEqual(later(snapshots[t], t), [], 'the seed as of ' + t);
    for (const outside of ['2027-01-01T00:00:00-05:00', '2024-12-01T00:00:00-05:00']) assert.throws(() => select(outside), /not inside/, outside);
    for (const bad of ['2026-06-01T00:00:00', '2026-06-01', undefined]) assert.throws(() => select(bad), /UTC offset/, String(bad));
  });

  test('T23d [Data] a contradiction planted for each of the 16 story rules is caught by problems()', () => {
    const {seed, manifest} = onePass();
    const mine = data => data.jobs.find(j => j.owner_person_id === OWNER && j.run && j.run.end_kind === 'completed' && j.protocol_id);
    const local = (value, hhmm) => value.slice(0, 11) + hhmm + value.slice(16);
    const plants = {
      story: (data, m) => m.stories.find(x => x.template === 'campaign_labmate').records.pop(),
      metrics: data => { const j = mine(data); j.run.metrics.accuracy = Math.round((j.run.metrics.accuracy + 0.05) * 1000) / 1000; return j.id; },
      versions: data => { const done = data.jobs.filter(j => j.run && j.run.end_kind === 'completed' && j.protocol_id && /^cfg-mae-b16-v\d+$/.test(j.config_id));
        const top = Math.max(...done.map(j => Number(j.config_id.split('-v')[1])));
        for (const j of done.filter(x => x.config_id === 'cfg-mae-b16-v' + top)) j.run.metrics = {...j.run.metrics, accuracy: 0.5};
        return 'cfg-mae-b16-v' + top; },
      hours: data => { const j = data.jobs.find(x => x.submitted_by === 'labmate'); j.submitted_at = local(j.submitted_at, '03:10'); return j.id; },
      members: data => { const j = data.jobs.find(x => x.owner_person_id === 'person-mei'); j.owner_person_id = 'person-ines'; j.submitted_at = '2025-03-03T10:00:00-05:00'; return j.id; },
      reruns: (data, m) => { const s = m.stories.find(x => x.template === 'correction' && x.records.some(id => data.jobs.some(j => j.id === id)));
        const j = data.jobs.find(x => s.records.includes(x.id)); j.seed += 7; return j.id; },
      tables: data => { const t = data.tables.find(x => /Main results/.test(x.title)); t.created_at = '2025-01-02T10:00:00-05:00'; return t.id; },
      rationale: data => { const p = data.protocols.find(x => x.id === 'proto-subj-v2'); p.rationale = 'Let us try it.'; return p.id; },
      allocation: data => { const c = data.allocation_changes[0]; c.reason = 'Because.'; return c.id; },
      failures: data => { const j = data.jobs.find(x => x.stored_state === 'interrupted'); j.interrupt_reason = 'Node cpu-99 failed.'; return j.id; },
      notifications: data => { const n = data.notifications.find(x => x.kind === 'job.ended'); n.title = n.title.replace(/has completed|has failed|ran out of time/, 'is fine'); return n.id; },
      names: data => { const c = data.configs[3]; c.registered_by = 'person-zed'; return c.id; },
      deadlines: data => { const d = '2025-05-22'; for (const j of data.jobs) if (j.submitted_at >= '2025-05-01' && j.submitted_at < d && j.submitted_by !== 'script') j.submitted_at = '2025-04-15T10:00:00-04:00'; return d; },
      answers: data => { const p = data.protocols.find(x => x.id === 'proto-subj-v3'); p.signoffs.find(s => s.answer === 'decline').note = 'The test subjects must stay unseen.'; return p.id; },
      withdrawals: data => { const p = data.protocols.find(x => x.stored_state === 'withdrawn'); p.dataset_version = 'eeg-subjects-2026.2'; return p.id; },
      duplicates: data => { const j = mine(data), copy = {...structuredClone(j), id: 'job-a9999', submitted_at: '2026-12-21T10:00:00-05:00', request_id: 'req-copy'};
        data.jobs.push(copy); return copy.id; }
    };
    assert.deepEqual(Object.keys(plants), RULES);
    for (const rule of RULES) {
      const data = structuredClone(seed), m = structuredClone(manifest), id = plants[rule](data, m), rows = problems(data, m);
      assert.ok(rows.some(r => r.rule === rule && r.record_id === id), rule + ': no row for ' + id + ' in ' + JSON.stringify(rows.slice(0, 3)));
    }
  });

  test('T23e [Data] the coverage report counts only acts that happened: a removed notice, a planned run and a respond_by are listed apart, and a cancelled job counts once, on its submission', () => {
    const r = coverage.report(), seed = evaluation('seed.json'), clock = evaluation('clock.json').initial_time;
    const counted = coverage.count(seed, clock).counted;
    // A notice removed before its release time: not counted, and listed apart.
    const withRemoved = structuredClone(seed), removed = {...withRemoved.notifications[0], id: 'ntf-9998', removed_at: withRemoved.notifications[0].at};
    withRemoved.notifications.push(removed);
    assert.ok(!coverage.count(withRemoved, clock).counted.some(x => x.id === removed.id), 'a removed notice is not counted');
    const listedApart = coverage.SCHEDULED.find(k => k.kind === 'removed_notices').rows(withRemoved, Date.parse(clock));
    assert.ok(listedApart.some(([id]) => id === removed.id), 'and it is listed apart');
    assert.ok(!counted.some(x => seed.notifications.some(n => n.removed_at !== null && n.id === x.id)), 'no removed notice of the seed is counted');
    assert.deepEqual(r.scheduled.kinds.find(k => k.kind === 'respond_by').listed.map(x => x.id), seed.protocols.filter(p => p.stored_state === 'proposed').map(p => p.id));
    // A planted pending notice, a planned run after the clock and a cancelled job.
    const planted = structuredClone(seed), job = planted.jobs.find(j => j.owner_person_id === OWNER);
    planted.notifications.push({...planted.notifications[0], id: 'ntf-9999', kind: 'job.ended', object_type: 'job', object_id: job.id, at: '2027-01-02T09:00:00-05:00', removed_at: null});
    const out = coverage.count(planted, clock);
    assert.ok(!out.counted.some(x => x.id === 'ntf-9999') && out.exclusions.some(x => x.id === 'ntf-9999') === false, 'a notice after the clock is not a counted row');
    assert.deepEqual(out.counted.filter(x => x.id === job.id).map(x => x.kind), ['jobs'], 'a job counts once, on its submission');
    assert.deepEqual(r.actual.kinds.map(k => k.date_field), ['jobs[].submitted_at', 'protocols[].proposed_at', 'protocols[].signoffs[].at', 'tables[].created_at',
      'allocation_changes[].at', 'jobs[].review.updated_at', 'notifications[].at']);
    assert.ok(r.actual.global.distinct_dates >= 300 && r.actual.gaps.months_without_records.length === 0, r.actual.global.distinct_dates + ' dates');
  });

  test('T23f [Data] load and query: tests/evaluation.integration.cjs loads the delivery seed with env.load_seed on the real runtime and reads the counts of the coverage report through MCP',
    ...withRuntime('tests/evaluation.integration.cjs'));
}

test('PKG diagnostics on, off and broken give the same data', () => {
  const on = start(), off = start({logging: false}), broken = start(), v3 = proposed(ny('02', '09:10:00'), 'proto-subj-v3');
  broken.ctx.log = () => { throw new Error('logger offline'); };
  for (const f of [on, off, broken]) {
    f.event(ALLOCATION);
    f.advance(ny('02'));
    f.call('jobs.submit', SUBMIT);
    f.event(v3);
  }
  assert.deepEqual(on.data, off.data);
  assert.deepEqual(broken.data, off.data);
  assert.ok(on.logs.length);
  assert.equal(off.logs.length, 0);
});

test('PKG the small SHA-256 of src gives the same hash as node:crypto', () => {
  for (const text of ['', 'abc', 'x'.repeat(55), 'x'.repeat(64), canonical({b: [1, 'é'], a: {z: null, y: 0.712}}), '漢字 and 😀'.repeat(30)]) {
    assert.equal(sha256(text), crypto.createHash('sha256').update(text).digest('hex'), JSON.stringify(text).slice(0, 40));
  }
  assert.equal(canonical({b: 1, a: [2, {d: 3, c: 4}]}), '{"a":[2,{"c":4,"d":3}],"b":1}');
});

// The code of the App and of its sender, and the files that run with the business tests, each with the host modules that it needs.
// Not in these lists: the integration scripts load the runtime from the path they are given, and dev/ reads the plan.
const sources = dir => fs.readdirSync(path.join(ROOT, dir)).filter(file => file.endsWith('.cjs')).map(file => dir + '/' + file);
const APP_CODE = [...sources('src'), ...sources('infra'), 'plugin.cjs'];
const TEST_CODE = {'tests/business.test.cjs': ['fs', 'child_process', 'crypto'], 'tests/schema-validator.cjs': ['fs'], 'tests/harness.cjs': [], 'examples/run.cjs': []};
const HOST_MODULE = /^(?:node:)?(fs|child_process|net|http|https|os|crypto)$/;
// Every module that a file loads. A target that is not a plain string cannot be checked, so it fails.
function loads(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(!/\b(require|import)\s*\((?!\s*['"][^'"]+['"]\s*\))/.test(text), file + ' loads a module that a plain string does not name');
  return {text, targets: [...text.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]/g)].map(match => match[1])};
}

test('PKG the text of src, infra and plugin.cjs has no host clock, timer or random source, no process, fetch, performance or crypto, and no require of a Node module', () => {
  // `Date(` with no `new` gives the host time as text. `new Date(value)`, `Date.UTC` and `Date.parse` read no clock.
  const banned = [/Date\.now\s*\(/, /new\s+Date\s*\(\s*\)/, /(?<!new\s+)\bDate\s*\(/, /Math\.random/, /\b(fetch|process|performance|setTimeout|setInterval|crypto)\b/];
  assert.ok(APP_CODE.includes('src/operations.cjs') && APP_CODE.includes('src/time.cjs') && APP_CODE.includes('src/sha256.cjs') && APP_CODE.includes('infra/sender.cjs'));
  for (const file of APP_CODE) {
    const {text, targets} = loads(file);
    for (const pattern of banned) assert.ok(!pattern.test(text), file + ' matches ' + pattern);
    for (const target of targets) assert.ok(!HOST_MODULE.test(target) && target.startsWith('.'), file + ' requires ' + target);
  }
  const found = text => banned.some(pattern => pattern.test(text));
  for (const text of ['Date.now()', 'new Date()', 'x = Date()', 'Math.random()', 'fetch(url)', 'process.env', 'performance.now()', 'setTimeout(f, 1)', 'setInterval(f, 1)', 'crypto.randomUUID()']) assert.ok(found(text), text);
  for (const text of ['new Date(instant)', 'Date.UTC(2026, 11, 2)', 'Date.parse(value)', 'processed', 'refetch']) assert.ok(!found(text), text);
});

test('PKG no require in src, infra, plugin.cjs, tests/business.test.cjs, tests/harness.cjs, tests/schema-validator.cjs or examples/run.cjs leaves the package, and the last four load only the host modules that they need', () => {
  for (const file of [...APP_CODE, ...Object.keys(TEST_CODE)]) {
    for (const target of loads(file).targets) {
      const builtin = target.startsWith('node:') || builtinModules.includes(target), host = HOST_MODULE.exec(target);
      const inside = target.startsWith('.') && path.resolve(ROOT, path.dirname(file), target).startsWith(ROOT + path.sep);
      assert.ok(builtin || inside, file + ' requires ' + target);
      assert.ok(!host || (TEST_CODE[file] || []).includes(host[1]), file + ' requires ' + target);
    }
  }
});

test('PKG contribution.json declares one publish entry for channel.email, no receiver and no required App, so Mail is optional and send-only', () => {
  const {messaging, dependencies} = require('../contribution/contribution.json');
  assert.deepEqual(messaging.publishes.map(e => [e.channel, e.schema_id, e.event_type, e.payload_schema_id, e.schema_ref]),
    [['channel.email', 'urn:pale:email-message:2', 'org.pale.mail.notification.v1', 'urn:pale:email-payload:1', 'schemas/router-message.schema.json']]);
  assert.deepEqual([messaging.receives, dependencies.required_apps, require('../app.json').dependencies], [[], [], []]);
});

test('PKG tools.json has exactly the 15 read and 14 write operations of the plan, app.json declares the ten events, and the fixture has the counts of the plan', () => {
  assert.deepEqual(tools.filter(t => t.read_only).map(t => t.name).sort(), READS.map(n => 'benchline.' + n).sort());
  assert.deepEqual(tools.filter(t => !t.read_only).map(t => t.name).sort(), WRITES.map(n => 'benchline.' + n).sort());
  assert.deepEqual(require('../app.json').event_types, EVENTS.map(n => 'benchline.' + n));
  assert.deepEqual(require('../contribution/contribution.json').events.accepts.map(e => e.type), EVENTS.map(n => 'benchline.' + n));
  const d = require('../fixtures/minimal.json'), now = Date.parse(require('../fixtures/clock.json').initial_time), views = require('../src/views.cjs');
  const states = list => [...new Set(list.map(j => views.jobState(j, now)))].sort();
  const results = d.jobs.filter(j => views.hasResult(j, now));
  assert.deepEqual([d.partitions.length, d.people.length, d.allocation_changes.length, d.configs.length, new Set(d.configs.map(c => c.family)).size], [3, 6, 2, 12, 4]);
  assert.deepEqual([new Set(d.protocols.map(p => p.line)).size, d.protocols.length, [...new Set(d.protocols.map(p => views.protocolState(p, now)))].sort()],
    [3, 7, ['declined', 'expired', 'proposed', 'signed', 'superseded', 'withdrawn']]);
  assert.deepEqual([d.jobs.length, d.jobs.filter(j => j.owner_person_id === OWNER).length, states(d.jobs), states(d.jobs.filter(j => j.owner_person_id === OWNER))],
    [60, 24, ['cancelled', 'completed', 'failed', 'held', 'interrupted', 'queued', 'running', 'timed_out'], ['cancelled', 'completed', 'failed', 'held', 'interrupted', 'queued', 'running', 'timed_out']]);
  assert.deepEqual([results.length, results.filter(j => j.review && j.review.excluded).length, results.filter(j => j.invalidation).length], [34, 3, 2]);
  assert.deepEqual([d.tables.map(t => t.stored_state).sort(), d.run_plans.length, d.notifications.length], [['discarded', 'draft', 'frozen', 'superseded'], 30, 14]);
  assert.equal(require('../contribution/dataset.json').expected_counts.records, plugin.records(d).length);
});
