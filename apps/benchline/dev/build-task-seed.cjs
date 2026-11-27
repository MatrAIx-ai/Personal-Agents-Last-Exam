'use strict';
// Writes examples/task-data/seed.json: the small task seed that the acceptance tests use, read at Wednesday 2 December 2026, 07:00 in New York.
// It replays a scripted history of November and the first day of December through the App's own hooks (dev/replay.cjs), so the App made every record.
// At its clock it gives the plan's W1 example: a December allocation of 400 GPU-hours, 212 used and 60 reserved; Nadia has 36 used and 60 reserved of her share of 150.
// Run `node dev/build-task-seed.cjs` after a change, or with `--check` to compare with the committed file. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const {replay} = require('./replay.cjs');
const L = require('./lab.cjs');
const {event, call, plan, recorded, submit, period} = L;

const CLOCK = '2026-12-02T07:00:00-05:00';
const OUT = path.resolve(__dirname, '../examples/task-data/seed.json');
const acc = value => ({accuracy: value});

function steps() {
  const s = [
    // November: an older run under the first protocol, the subject-level protocol v2, the Atlas runs and Birch ablations.
    plan('2026-11-02 08:00', 'cfg-vit-s16-v1', {queue_wait_minutes: 20, run_minutes: 600, outcome: 'completed', metrics: acc(0.684)}),
    submit('2026-11-03 09:00', 'cfg-vit-s16-v1', 0, 'gpu-a', 1, 12, 'proto-subj-v1'),
    recorded('2026-11-04 08:00', 'job-0081', 'person-mei', 'cfg-mae-b16-v1', 0, 'gpu-h', 2, 12, '2026-11-04 08:30', '2026-11-04 18:30', 'completed', null, acc(0.661)),
    recorded('2026-11-05 09:10', 'job-0082', 'person-tomas', 'cfg-vit-s16-v1', 1, 'gpu-a', 2, 24, '2026-11-05 09:40', '2026-11-05 21:10', 'completed', 'proto-subj-v1', acc(0.679)),
    event('2026-11-16 10:00', 'protocol.proposed', {protocol_id: 'proto-subj-v2', line: 'subject-eval', dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-subjects',
      metrics: L.ACCURACY, seeds: [0, 1, 2], proposed_by: 'person-mei', rationale: 'A subject-level split, so no test subject is seen in training.'}),
    call('2026-11-16 14:05', 'protocols.respond', {id: 'proto-subj-v2', answer: 'sign', note: 'Agreed. Session splits leak subjects.'}),
    event('2026-11-17 09:30', 'protocol.answered', {protocol_id: 'proto-subj-v2', person_id: 'person-okafor', answer: 'sign', note: 'Use it for the paper.'}),
    plan('2026-11-17 10:00', 'cfg-atlas-v1', {queue_wait_minutes: 40, run_minutes: 540, outcome: 'completed', metrics: acc(0.702)}),
    plan('2026-11-17 10:00', 'cfg-atlas-v1', {seed: 1, queue_wait_minutes: 40, run_minutes: 540, outcome: 'completed', metrics: acc(0.708)}),
    plan('2026-11-17 10:00', 'cfg-atlas-v1', {seed: 2, queue_wait_minutes: 40, run_minutes: 560, outcome: 'completed', metrics: acc(0.697)}),
    submit('2026-11-17 11:00', 'cfg-atlas-v1', 0, 'gpu-h', 2, 10, 'proto-subj-v2'),
    submit('2026-11-17 11:02', 'cfg-atlas-v1', 1, 'gpu-h', 2, 10, 'proto-subj-v2'),
    submit('2026-11-17 11:04', 'cfg-atlas-v1', 2, 'gpu-h', 2, 10, 'proto-subj-v2'),
    plan('2026-11-18 09:00', 'cfg-birch-abl-v1', {queue_wait_minutes: 60, run_minutes: 600, outcome: 'completed', metrics: acc(0.655)}),
    plan('2026-11-18 09:00', 'cfg-birch-abl-v2', {queue_wait_minutes: 60, run_minutes: 600, outcome: 'completed', metrics: acc(0.641)}),
    plan('2026-11-18 09:00', 'cfg-birch-abl-v3', {queue_wait_minutes: 60, run_minutes: 480, outcome: 'failed', error: 'CUDA out of memory in the decoder.'}),
    recorded('2026-11-19 07:30', 'job-0090', 'person-ines', 'cfg-vit-s16-v2', 0, 'cpu', 1, 48, '2026-11-19 07:35', '2026-11-20 06:35', 'completed', 'proto-subj-v2', acc(0.612)),
    event('2026-11-24 09:00', 'allocation.changed', {allocation_hours: 340, changed_by: 'person-okafor', reason: 'The department took back 40 hours for a course.'})
  ];
  // Birch ablations at night, three at a time. Each job writes its job.ended notice when it is submitted.
  for (const [day, configs] of [['2026-11-20', ['cfg-birch-abl-v1', 'cfg-birch-abl-v2', 'cfg-birch-abl-v3']], ['2026-11-21', ['cfg-birch-abl-v1', 'cfg-birch-abl-v2']]]) {
    configs.forEach((config, i) => s.push(submit(day + ' 21:0' + i, config, day === '2026-11-20' ? 0 : 1, 'gpu-a', 1, 12, null)));
  }
  s.push(
    // December: a new period with the shares of the term.
    period('2026-12-01 00:00', 'alloc-2026-12', 'December', '2026-12-01 00:00', '2026-12-31 23:59:59', 400, {'person-nadia': 150, 'person-mei': 120, 'person-tomas': 80, 'person-ines': 40}),
    recorded('2026-12-01 07:00', 'job-0101', 'person-mei', 'cfg-mae-b16-v2', 0, 'gpu-h', 2, 12, '2026-12-01 07:20', '2026-12-01 18:20', 'completed', 'proto-subj-v2', acc(0.712), 'ev-bl-101'),
    recorded('2026-12-01 07:01', 'job-0102', 'person-mei', 'cfg-mae-b16-v2', 1, 'gpu-h', 2, 12, '2026-12-01 07:20', '2026-12-01 18:20', 'completed', 'proto-subj-v2', acc(0.705), 'ev-bl-102'),
    recorded('2026-12-01 07:02', 'job-0103', 'person-mei', 'cfg-mae-b16-v2', 2, 'gpu-h', 2, 12, '2026-12-01 07:21', '2026-12-01 18:21', 'completed', 'proto-subj-v2', acc(0.719), 'ev-bl-103'),
    recorded('2026-12-01 07:30', 'job-0104', 'person-tomas', 'cfg-atlas-v2', 0, 'gpu-h', 2, 12, '2026-12-01 07:40', '2026-12-01 18:40', 'completed', 'proto-subj-v2', acc(0.731), 'ev-bl-104'),
    plan('2026-12-01 07:45', 'cfg-vit-s16-v2', {seed: 0, queue_wait_minutes: 30, run_minutes: 720, outcome: 'completed', metrics: acc(0.694)}),
    plan('2026-12-01 07:45', 'cfg-vit-s16-v2', {seed: 1, queue_wait_minutes: 30, run_minutes: 720, outcome: 'completed', metrics: acc(0.689)}),
    plan('2026-12-01 07:45', 'cfg-vit-s16-v2', {seed: 2, partition_id: 'gpu-a', queue_wait_minutes: 30, run_minutes: 720, outcome: 'completed', metrics: acc(0.701)}),
    // A 15-hour run under a 12-hour limit on the H100 nodes ends timed_out (W2).
    plan('2026-12-01 07:45', 'cfg-vit-s16-v2', {seed: 2, partition_id: 'gpu-h', queue_wait_minutes: 20, run_minutes: 900, outcome: 'completed', metrics: acc(0.703)}),
    plan('2026-12-01 07:45', 'cfg-mae-b16-v3', {seed: 2, queue_wait_minutes: 30, run_minutes: 600, outcome: 'completed', metrics: acc(0.716)}),
    plan('2026-12-01 07:45', 'cfg-mae-b16-v2', {queue_wait_minutes: 45, run_minutes: 660, outcome: 'completed', metrics: acc(0.709)}),
    submit('2026-12-01 08:00', 'cfg-vit-s16-v2', 0, 'gpu-a', 1, 12, 'proto-subj-v2'),
    submit('2026-12-01 08:01', 'cfg-vit-s16-v2', 1, 'gpu-a', 1, 12, 'proto-subj-v2'),
    submit('2026-12-01 08:02', 'cfg-vit-s16-v2', 2, 'gpu-a', 1, 12, 'proto-subj-v2'),
    // Two jobs with no run plan yet: they wait in the queue and reserve 30 GPU-hours each.
    submit('2026-12-01 21:00', 'cfg-mae-b16-v3', 0, 'gpu-h', 1, 15, 'proto-subj-v2'),
    submit('2026-12-01 21:01', 'cfg-mae-b16-v3', 1, 'gpu-h', 1, 15, 'proto-subj-v2'),
    plan('2026-12-01 21:30', 'cfg-birch-abl-v1', {queue_wait_minutes: 60, run_minutes: 600, outcome: 'completed', metrics: acc(0.655)})
  );
  return s;
}
// Steps run in time order. Steps at one time keep their written order.
const ordered = () => steps().map((step, i) => [step, i]).sort((a, b) => Date.parse(a[0].at) - Date.parse(b[0].at) || a[1] - b[1]).map(([step]) => step);
function build() { return replay(L.base(), ordered()); }
if (require.main === module) {
  const text = JSON.stringify(build(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) { console.error('examples/task-data/seed.json is out of date.'); process.exitCode = 1; }
    else console.log('Checked examples/task-data/seed.json.');
  } else { fs.writeFileSync(OUT, text); console.log('Wrote examples/task-data/seed.json.'); }
}
module.exports = {build, steps: ordered, CLOCK};
