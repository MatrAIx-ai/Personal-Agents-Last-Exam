'use strict';
// Writes fixtures/minimal.json: the package fixture with the counts of the plan, read at Wednesday 9 December 2026, 10:00 in New York (fixtures/clock.json).
// It replays the history of the task seed and then the first week of December through the App's own hooks (dev/replay.cjs), so the App made every record.
// The fixture keeps the 14 newest notifications. Activity rows that name a dropped notification are dropped with it.
// Run `node dev/build-fixture.cjs` after a change, or with `--check` to compare with the committed file. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const {replay} = require('./replay.cjs');
const L = require('./lab.cjs');
const task = require('./build-task-seed.cjs');
const {event, call, plan, recorded, submit} = L;

const CLOCK = '2026-12-09T10:00:00-05:00', KEEP = 14;
const OUT = path.resolve(__dirname, '../fixtures/minimal.json');
const acc = value => ({accuracy: value});
const metrics2 = (a, f1) => ({accuracy: a, macro_f1: f1});
const LABMATES = ['person-mei', 'person-tomas', 'person-farid', 'person-ines'];

function week() {
  const s = [
    // A labmate proposes a trial-level split. Nadia declines it, proposes five seeds, and the lab head signs.
    event('2026-12-02 11:00', 'protocol.proposed', {protocol_id: 'proto-subj-v3', line: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-trials',
      metrics: L.ACCURACY, seeds: [0, 1, 2], proposed_by: 'person-tomas', rationale: 'A trial-level split needs a third of the compute.'}),
    call('2026-12-02 14:00', 'protocols.respond', {id: 'proto-subj-v3', answer: 'decline', note: 'The test subjects must stay unseen.'}),
    call('2026-12-02 14:10', 'protocols.propose', {id: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects', metrics: L.ACCURACY,
      seeds: [0, 1, 2, 3, 4], rationale: 'Five seeds for the paper.'}),
    event('2026-12-03 10:00', 'protocol.answered', {protocol_id: 'proto-subj-v4', person_id: 'person-okafor', answer: 'sign', note: 'Fine with five seeds.'}),
    // The trial-level line: a withdrawn first version, then one that nobody answers and that expires.
    event('2026-12-02 12:00', 'protocol.proposed', {protocol_id: 'proto-trial-v1', line: 'trial-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-trials',
      metrics: [{name: 'accuracy', direction: 'higher'}, {name: 'macro_f1', direction: 'higher'}], seeds: [0, 1], proposed_by: 'person-tomas', rationale: 'Trial-level numbers for the workshop.'}),
    event('2026-12-02 16:00', 'protocol.withdrawn', {protocol_id: 'proto-trial-v1', note: 'Withdrawn after the lab meeting.'}),
    event('2026-12-03 09:00', 'protocol.proposed', {protocol_id: 'proto-trial-v2', line: 'trial-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-trials',
      metrics: [{name: 'accuracy', direction: 'higher'}], seeds: [0, 1, 2], proposed_by: 'person-tomas', rationale: 'Three seeds, accuracy only.'}),
    event('2026-12-07 15:00', 'protocol.proposed', {protocol_id: 'proto-lat-v1', line: 'latency-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects',
      metrics: [{name: 'latency_ms', direction: 'lower'}], seeds: [0], proposed_by: 'person-farid', rationale: 'Inference latency on one seed.'}),
    // Run plans for the week.
    plan('2026-12-02 12:30', 'cfg-mae-b16-v3', {seed: 0, queue_wait_minutes: 60, run_minutes: 600, outcome: 'completed', metrics: acc(0.711)}),
    plan('2026-12-02 12:30', 'cfg-mae-b16-v3', {seed: 1, queue_wait_minutes: 240, run_minutes: 600, outcome: 'completed', metrics: acc(0.709)}),
    plan('2026-12-03 10:30', 'cfg-mae-b16-v3', {seed: 3, queue_wait_minutes: 30, run_minutes: 620, outcome: 'completed', metrics: acc(0.714)}),
    plan('2026-12-03 10:30', 'cfg-mae-b16-v3', {seed: 4, queue_wait_minutes: 30, run_minutes: 610, outcome: 'completed', metrics: acc(0.707)}),
    plan('2026-12-03 10:30', 'cfg-atlas-v2', {queue_wait_minutes: 20, run_minutes: 560, outcome: 'completed', metrics: acc(0.733)}),
    plan('2026-12-03 10:30', 'cfg-atlas-v2', {seed: 3, queue_wait_minutes: 20, run_minutes: 300, outcome: 'failed', error: 'NaN loss at step 41,200.'}),
    plan('2026-12-03 10:30', 'cfg-atlas-v3', {queue_wait_minutes: 45, run_minutes: 1500, outcome: 'completed', metrics: acc(0.738)}),
    plan('2026-12-04 08:00', 'cfg-vit-s16-v3', {queue_wait_minutes: 30, run_minutes: 480, outcome: 'completed', metrics: acc(0.698)}),
    plan('2026-12-04 08:00', 'cfg-vit-s16-v3', {partition_id: 'cpu', queue_wait_minutes: 10, run_minutes: 1800, outcome: 'completed', metrics: acc(0.698)}),
    plan('2026-12-04 08:00', 'cfg-mae-b16-v1', {queue_wait_minutes: 15, run_minutes: 400, outcome: 'completed', metrics: acc(0.664)}),
    plan('2026-12-04 08:00', 'cfg-birch-abl-v2', {seed: 2, queue_wait_minutes: 60, run_minutes: 600, outcome: 'completed', metrics: acc(0.644)}),
    plan('2026-12-04 08:00', 'cfg-birch-abl-v3', {seed: 1, queue_wait_minutes: 60, run_minutes: 480, outcome: 'completed', metrics: acc(0.638)}),
    plan('2026-12-04 08:00', 'cfg-mae-b16-v2', {seed: 3, queue_wait_minutes: 30, run_minutes: 660, outcome: 'completed', metrics: acc(0.716)}),
    plan('2026-12-04 08:00', 'cfg-mae-b16-v2', {seed: 4, queue_wait_minutes: 30, run_minutes: 660, outcome: 'completed', metrics: acc(0.71)}),
    plan('2026-12-04 08:00', 'cfg-atlas-v3', {seed: 0, partition_id: 'gpu-a', queue_wait_minutes: 40, run_minutes: 1200, outcome: 'completed', metrics: acc(0.736)}),
    plan('2026-12-04 08:00', 'cfg-vit-s16-v2', {seed: 3, queue_wait_minutes: 30, run_minutes: 720, outcome: 'completed', metrics: acc(0.697)}),
    plan('2026-12-04 08:00', 'cfg-vit-s16-v2', {seed: 4, queue_wait_minutes: 30, run_minutes: 720, outcome: 'completed', metrics: acc(0.692)}),
    // The department adds its end-of-year pool, and Ines gets a larger share for her thesis runs.
    event('2026-12-02 10:00', 'allocation.changed', {allocation_hours: 1500, shares: [{person_id: 'person-ines', share_hours: 60}, {person_id: 'person-nadia', share_hours: 320}],
      changed_by: 'person-okafor', reason: 'The department added its end-of-year pool.'}),
    // Nadia's week: the MAE-B/16 v3 seeds under v4, a held job, a cancelled one, a timed-out one and one that is interrupted.
    submit('2026-12-03 11:00', 'cfg-mae-b16-v3', 3, 'gpu-h', 1, 12, 'proto-subj-v4'),
    submit('2026-12-03 11:01', 'cfg-mae-b16-v3', 4, 'gpu-h', 1, 12, 'proto-subj-v4'),
    submit('2026-12-04 09:30', 'cfg-vit-s16-v2', 3, 'gpu-a', 1, 12, 'proto-subj-v4'),
    submit('2026-12-04 21:00', 'cfg-vit-s16-v2', 4, 'gpu-a', 1, 12, 'proto-subj-v4'),
    submit('2026-12-04 21:05', 'cfg-vit-s16-v2', 2, 'gpu-h', 2, 12, 'proto-subj-v4'),
    submit('2026-12-05 10:00', 'cfg-atlas-v3', 0, 'gpu-a', 2, 24, 'proto-subj-v4'),
    submit('2026-12-06 09:05', 'cfg-birch-abl-v3', 1, 'gpu-a', 1, 12, null, {hold: true}),
    // A seed outside the protocol, with no run plan yet: it waits in the queue at the clock.
    submit('2026-12-09 09:00', 'cfg-vit-s16-v2', 5, 'gpu-a', 1, 12, null),
    submit('2026-12-08 22:00', 'cfg-atlas-v3', 1, 'gpu-h', 2, 24, 'proto-subj-v4'),
    event('2026-12-08 21:30', 'job.script_submitted', {script: 'atlas-sweep.sh', config_id: 'cfg-atlas-v2', seed: 4, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12,
      protocol_id: 'proto-subj-v4', hold: false}),
    // The script asks for 30 hours on gpu-h, whose longest job time is 24: no job, and one job.submission_rejected notice.
    event('2026-12-08 23:30', 'job.script_submitted', {script: 'atlas-sweep.sh', config_id: 'cfg-atlas-v2', seed: 3, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 30,
      protocol_id: 'proto-subj-v4', hold: false})
  ];
  // Labmates' jobs of the week: completed runs of their own configs, two failures, one timed out and one running at the clock.
  const runs = [
    ['2026-12-02 08:00', 'person-mei', 'cfg-vit-s16-v2', 0, 'gpu-h', 4, 12, '08:20', '19:05', 'completed', 'proto-subj-v2', 0.698],
    ['2026-12-02 09:30', 'person-tomas', 'cfg-vit-s16-v3', 0, 'gpu-a', 2, 12, '09:45', '17:45', 'completed', 'proto-subj-v2', 0.699],
    ['2026-12-02 09:31', 'person-tomas', 'cfg-vit-s16-v3', 1, 'gpu-a', 2, 12, '09:46', '17:40', 'completed', 'proto-subj-v2', 0.694],
    ['2026-12-02 09:32', 'person-tomas', 'cfg-vit-s16-v3', 2, 'gpu-a', 2, 12, '09:46', '17:52', 'completed', 'proto-subj-v2', 0.701],
    ['2026-12-03 08:10', 'person-mei', 'cfg-mae-b16-v2', 3, 'gpu-h', 2, 12, '08:30', '19:30', 'completed', 'proto-subj-v4', 0.716],
    ['2026-12-03 08:11', 'person-mei', 'cfg-mae-b16-v2', 4, 'gpu-h', 2, 12, '08:30', '19:31', 'completed', 'proto-subj-v4', 0.71],
    ['2026-12-03 13:00', 'person-farid', 'cfg-mae-b16-v1', 0, 'cpu', 8, 24, '13:05', '14:20', 'failed', null, null],
    ['2026-12-03 13:01', 'person-farid', 'cfg-mae-b16-v1', 1, 'cpu', 8, 6, '13:05', '19:05', 'timed_out', null, null],
    ['2026-12-04 10:00', 'person-ines', 'cfg-vit-s16-v2', 1, 'cpu', 1, 48, '10:05', '10:40', 'failed', 'proto-subj-v2', null],
    ['2026-12-04 10:01', 'person-ines', 'cfg-vit-s16-v2', 2, 'cpu', 1, 12, '10:05', '22:05', 'timed_out', 'proto-subj-v2', null],
    ['2026-12-09 09:20', 'person-tomas', 'cfg-atlas-v2', 1, 'gpu-h', 2, 12, '13:00', '22:15', 'completed', 'proto-subj-v4', 0.729],
    ['2026-12-09 09:21', 'person-tomas', 'cfg-atlas-v2', 2, 'gpu-h', 2, 12, '13:00', '22:27', 'completed', 'proto-subj-v4', 0.735],
    ['2026-12-04 15:00', 'person-mei', 'cfg-mae-b16-v3', 0, 'gpu-h', 2, 12, '15:20', '18:10', 'failed', 'proto-subj-v4', null],
    ['2026-12-05 08:00', 'person-mei', 'cfg-mae-b16-v3', 1, 'gpu-h', 2, 12, '08:15', '19:15', 'completed', 'proto-subj-v4', 0.712],
    ['2026-12-05 08:01', 'person-mei', 'cfg-mae-b16-v3', 2, 'gpu-h', 2, 12, '08:15', '19:20', 'completed', 'proto-subj-v4', 0.715],
    ['2026-12-05 09:00', 'person-farid', 'cfg-atlas-v1', 0, 'gpu-a', 4, 10, '09:10', '19:10', 'timed_out', null, null],
    ['2026-12-05 14:00', 'person-ines', 'cfg-vit-s16-v1', 0, 'gpu-a', 1, 12, '14:05', '22:00', 'completed', 'proto-subj-v1', 0.681],
    ['2026-12-06 10:00', 'person-tomas', 'cfg-vit-s16-v3', 3, 'gpu-a', 2, 12, '10:10', '11:25', 'failed', 'proto-subj-v4', null],
    ['2026-12-06 10:01', 'person-tomas', 'cfg-vit-s16-v3', 4, 'gpu-a', 2, 8, '10:10', '18:10', 'timed_out', 'proto-subj-v4', null],
    ['2026-12-09 09:10', 'person-mei', 'cfg-mae-b16-v3', 3, 'gpu-h', 2, 12, '10:30', '21:20', 'completed', 'proto-subj-v4', 0.713],
    ['2026-12-07 08:01', 'person-mei', 'cfg-mae-b16-v3', 4, 'gpu-h', 2, 12, '08:10', '09:45', 'failed', 'proto-subj-v4', null],
    ['2026-12-07 11:00', 'person-farid', 'cfg-birch-abl-v1', 0, 'cpu', 4, 24, '11:05', '15:30', 'failed', null, null],
    ['2026-12-09 08:00', 'person-ines', 'cfg-vit-s16-v1', 1, 'gpu-a', 1, 12, '11:00', '18:50', 'completed', 'proto-subj-v1', 0.676],
    ['2026-12-09 09:00', 'person-tomas', 'cfg-atlas-v3', 2, 'gpu-h', 2, 24, '12:00', '23:59', 'completed', 'proto-subj-v4', 0.737],
    ['2026-12-08 12:00', 'person-mei', 'cfg-mae-b16-v2', 0, 'gpu-a', 2, 24, '12:30', '23:30', 'completed', 'proto-subj-v4', 0.711],
    ['2026-12-09 07:00', 'person-farid', 'cfg-atlas-v1', 1, 'gpu-a', 2, 12, '07:10', '18:10', 'completed', null, 0.703],
    ['2026-12-08 14:00', 'person-ines', 'cfg-vit-s16-v1', 2, 'gpu-a', 1, 12, '14:05', '14:30', 'failed', 'proto-subj-v1', null],
    ['2026-12-09 07:30', 'person-ines', 'cfg-vit-s16-v2', 3, 'cpu', 1, 48, '07:35', '23:10', 'completed', 'proto-subj-v4', 0.6],
    ['2026-12-09 09:40', 'person-farid', 'cfg-atlas-v1', 2, 'gpu-a', 2, 12, '15:00', '23:00', 'completed', null, 0.699]
  ];
  runs.forEach(([when, owner, config, seed, part, gpus, limit, from, to, kind, protocol, value], i) => {
    const day = when.slice(0, 10);
    s.push(recorded(when, 'job-' + String(131 + i).padStart(4, '0'), owner, config, seed, part, gpus, limit, day + ' ' + from, day + ' ' + to, kind, protocol,
      value === null ? null : acc(value)));
  });
  s.push(
    // Interruptions, holds, cancellations, invalidations and dispositions.
    event('2026-12-06 03:00', 'job.interrupted', {job_id: 'job-a0020', reason: 'Node gpu-a-03 failed.'}),
    call('2026-12-04 21:10', 'jobs.cancel', {id: 'job-a0018'}),
    event('2026-12-06 14:30', 'result.invalidated', {job_id: 'job-0102', invalidated_by: 'person-mei', reason: 'Seed 1 read a cached split from the old dataset version.'}),
    event('2026-12-07 10:00', 'result.invalidated', {job_id: 'job-0134', invalidated_by: 'person-tomas', reason: 'The config had the wrong patch size.'}),
    call('2026-12-04 09:00', 'results.update', {id: 'job-a0002', disposition: 'excluded', reason: 'Run on the old dataset cache.'}),
    call('2026-12-04 09:01', 'results.update', {id: 'job-a0008', disposition: 'excluded', reason: 'Ablation config had a typo.'}),
    call('2026-12-04 09:02', 'results.update', {id: 'job-a0001', disposition: 'excluded', reason: 'Session split, kept only for comparison.'}),
    call('2026-12-04 09:03', 'results.update', {id: 'job-a0010', tags: ['paper', 'baseline'], note: 'ViT-S/16 baseline, seed 0.'}),
    // The tables: version 1 frozen and then superseded by version 2, one discarded draft and one open draft.
    call('2026-12-02 15:00', 'tables.create', {id: 'proto-subj-v2', title: 'Main results'}),
    call('2026-12-02 15:05', 'tables.update', {id: 'tbl-0001.v1', rows: [{name: 'MAE-B/16 v2', result_ids: ['job-0101', 'job-0102', 'job-0103']},
      {name: 'ViT-S/16 v2', result_ids: ['job-a0010', 'job-a0011', 'job-a0012']}]}),
    call('2026-12-02 15:10', 'tables.freeze', {id: 'tbl-0001.v1'}),
    call('2026-12-06 15:00', 'tables.revise', {id: 'tbl-0001.v1'}),
    call('2026-12-06 15:05', 'tables.update', {id: 'tbl-0001.v2', rows: [{name: 'ViT-S/16 v2', result_ids: ['job-a0010', 'job-a0011', 'job-a0012']}]}),
    call('2026-12-06 15:10', 'tables.freeze', {id: 'tbl-0001.v2'}),
    call('2026-12-07 09:30', 'tables.create', {id: 'proto-subj-v4', title: 'Five-seed results'}),
    call('2026-12-07 09:35', 'tables.update', {id: 'tbl-0002.v1', rows: [{name: 'MAE-B/16 v3', result_ids: ['job-a0015', 'job-a0016']}]}),
    call('2026-12-07 09:40', 'tables.discard', {id: 'tbl-0002.v1'}),
    call('2026-12-08 10:00', 'tables.create', {id: 'proto-subj-v4', title: 'Five-seed results'}),
    call('2026-12-08 10:05', 'tables.update', {id: 'tbl-0003.v1', rows: [{name: 'MAE-B/16 v3', result_ids: ['job-0144', 'job-0145', 'job-a0015', 'job-a0016']}]})
  );
  return s;
}
const ordered = () => [...task.steps(), ...week()].map((step, i) => [step, i]).sort((a, b) => Date.parse(a[0].at) - Date.parse(b[0].at) || a[1] - b[1]).map(([step]) => step);
// The newest notifications only. A row that names a dropped notification goes with it, so every row still names an object of the fixture.
function trim(data) {
  const dropped = new Set(data.notifications.slice(0, -KEEP).map(n => n.id));
  data.notifications = data.notifications.slice(-KEEP);
  data.activity = data.activity.filter(row => !dropped.has(row.object_id));
  return data;
}
function build() { return trim(replay(L.base(), ordered())); }
if (require.main === module) {
  const text = JSON.stringify(build(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) { console.error('fixtures/minimal.json is out of date.'); process.exitCode = 1; }
    else console.log('Checked fixtures/minimal.json.');
  } else { fs.writeFileSync(OUT, text); console.log('Wrote fixtures/minimal.json.'); }
}
module.exports = {build, CLOCK};
