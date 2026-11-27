'use strict';
// The story templates of the delivery dataset in data/evaluation/. Every record of the dataset comes from one story, and a story fixes all its parts together:
// a campaign (a config, its run plans, its seeds, their jobs and results), a protocol change (the proposal, its rationale and its answers),
// an allocation change (its reason and the jobs it holds), a paper table (its rows, its freeze and its correction), a script sweep, and a node failure.
// The lab, its people, configs, datasets and results are fictional. Used only by the dev scripts.

// Fictional people of the lab. Ines joins in September 2025.
const PEOPLE = [
  {person_id: 'person-nadia', name: 'Nadia Ferrante', role: 'PhD student'}, {person_id: 'person-okafor', name: 'Prof. Okafor', role: 'Lab head'},
  {person_id: 'person-mei', name: 'Mei Lindqvist', role: 'Postdoc'}, {person_id: 'person-tomas', name: 'Tomas Arce', role: 'PhD student'},
  {person_id: 'person-farid', name: 'Farid Haddad', role: 'Research engineer'}, {person_id: 'person-ines', name: 'Ines Varga', role: 'Master\'s student'}
];
const JOINS = {'person-ines': '2025-09-01'};
const LABMATES = ['person-mei', 'person-tomas', 'person-farid', 'person-ines'];

// The datasets of the lab, by era. A protocol version and a config name one dataset version.
const ERAS = [
  {from: '2025-01-01', dataset: 'eeg-subjects-2024.4'},
  {from: '2025-07-01', dataset: 'eeg-subjects-2025.2'},
  {from: '2026-02-01', dataset: 'eeg-subjects-2026.1'},
  {from: '2026-08-01', dataset: 'eeg-subjects-2026.2'}
];
// Eight model families. `base` is the expected accuracy of the first version on the subject-level split, `step` the gain of each later version,
// `hours` the typical run time on two H100 GPUs, and `owner` the person who mostly works on it.
const FAMILIES = [
  {family: 'mae-b16', base: 0.672, step: 0.009, hours: 10, owner: 'person-mei', params: {lr: 0.0003, epochs: 60, mask_ratio: 0.75}},
  {family: 'vit-s16', base: 0.655, step: 0.008, hours: 8, owner: 'person-nadia', params: {lr: 0.001, epochs: 40, patch: 16}},
  {family: 'atlas', base: 0.684, step: 0.011, hours: 11, owner: 'person-nadia', params: {lr: 0.0002, epochs: 120, depth: 12}},
  {family: 'birch-abl', base: 0.628, step: 0.004, hours: 6, owner: 'person-nadia', params: {lr: 0.0003, epochs: 30, ablate: 'no_mask'}},
  {family: 'conformer', base: 0.661, step: 0.007, hours: 9, owner: 'person-tomas', params: {lr: 0.0005, epochs: 80, blocks: 8}},
  {family: 'eegnet', base: 0.612, step: 0.006, hours: 3, owner: 'person-ines', params: {lr: 0.001, epochs: 200, dropout: 0.25}},
  {family: 'tcn', base: 0.634, step: 0.005, hours: 5, owner: 'person-farid', params: {lr: 0.002, epochs: 100, levels: 6}},
  {family: 'lstm-base', base: 0.598, step: 0.004, hours: 4, owner: 'person-tomas', params: {lr: 0.001, epochs: 60, layers: 2}}
];
// Protocol lines. Each has the split it evaluates and its first version, signed before the window.
const LINES = [
  {line: 'subject-eval', prefix: 'proto-subj', split: 'test-subjects', seeds: [0, 1, 2], metrics: [{name: 'accuracy', direction: 'higher'}]},
  {line: 'session-eval', prefix: 'proto-sess', split: 'test-sessions', seeds: [0, 1, 2], metrics: [{name: 'accuracy', direction: 'higher'}]},
  {line: 'trial-eval', prefix: 'proto-trial', split: 'test-trials', seeds: [0, 1], metrics: [{name: 'accuracy', direction: 'higher'}, {name: 'macro_f1', direction: 'higher'}]},
  {line: 'latency-eval', prefix: 'proto-lat', split: 'test-subjects', seeds: [0], metrics: [{name: 'latency_ms', direction: 'lower'}]},
  {line: 'transfer-eval', prefix: 'proto-xfer', split: 'held-out-site', seeds: [0, 1, 2], metrics: [{name: 'accuracy', direction: 'higher'}]},
  {line: 'robust-eval', prefix: 'proto-rob', split: 'noisy-subjects', seeds: [0, 1, 2], metrics: [{name: 'accuracy', direction: 'higher'}, {name: 'auroc', direction: 'higher'}]}
];
// The accuracy of a split relative to the subject-level split.
// The config ID suffix of each split.
const SUFFIX = {'test-subjects': '', 'test-sessions': '-sess', 'test-trials': '-trial', 'held-out-site': '-xfer', 'noisy-subjects': '-rob'};
const SPLIT_SHIFT = {'test-subjects': 0, 'test-sessions': 0.021, 'test-trials': 0.048, 'held-out-site': -0.037, 'noisy-subjects': -0.052};

// The kinds of protocol change. The rationale names what changes, and a decline note fits the kind of change. The story rules check both.
const CHANGES = {
  dataset: {rationale: v => 'Move to the dataset release ' + v.dataset_version + ', which fixes the subject labels.',
    decline: ['This makes the old numbers incomparable.', 'Keep the old release until the paper is out.']},
  seeds: {rationale: v => 'Use ' + v.seeds.length + ' seeds, so the spread across seeds is honest in the paper.',
    decline: ['More seeds cost too many GPU-hours before the deadline.', 'Three seeds are enough for this paper.']},
  split: {rationale: v => v.eval_split === 'test-trials' ? 'A trial-level split needs a third of the compute.' : 'Sessions of one subject leak into the test set, so test on new subjects.',
    decline: ['The test subjects must stay unseen.']},
  metrics: {rationale: v => 'Report ' + v.metrics.map(m => m.name).join(', ') + ', because the classes are not balanced.',
    decline: ['The extra metric is not in the venue\'s table.']}
};
const SIGN_NOTES = ['Agreed.', 'Fine for the paper.', 'Signed. Use it from the next runs.'];
// A version withdrawn for a typo carries the typo, and the version proposed again has the right value.
const TYPO = {'eeg-subjects-2026.2': 'eeg-subjects-2062.2'};

// Allocation changes in a quarter, with the reason that the lab head gives.
const CUTS = ['The department moved hours to the shared pool.', 'The cluster lost two H100 nodes, and the hours are cut until they are back.', 'Hours went to the teaching course this term.'];
const RAISES = ['The two H100 nodes are back, so the hours return.', 'The department returned unused hours.', 'The grant extension added hours for the paper push.', 'Hours from another lab were transferred to us.'];

// Fictional paper deadlines. Campaigns crowd into the three weeks before them.
const DEADLINES = [
  {day: '2025-03-14', name: 'Spring workshop 2025'}, {day: '2025-05-22', name: 'Summer conference 2025'}, {day: '2025-10-02', name: 'Autumn conference 2025'},
  {day: '2026-01-23', name: 'Winter journal issue 2026'}, {day: '2026-05-21', name: 'Summer conference 2026'}, {day: '2026-10-01', name: 'Autumn conference 2026'},
  {day: '2026-12-11', name: 'Year-end workshop 2026'}
];
// US federal holidays and the winter break of the lab: no one submits by hand on these days.
const HOLIDAYS = ['2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11', '2025-11-27', '2025-11-28',
  '2025-12-24', '2025-12-25', '2025-12-26', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31'];
// The quarters of the window. Each one is an allocation period with its opening hours and shares.
const QUARTERS = [
  {id: 'alloc-2025-q1', label: 'Q1 2025', from: '2025-01-01', to: '2025-03-31', hours: 7200},
  {id: 'alloc-2025-q2', label: 'Q2 2025', from: '2025-04-01', to: '2025-06-30', hours: 7800},
  {id: 'alloc-2025-q3', label: 'Q3 2025', from: '2025-07-01', to: '2025-09-30', hours: 7000},
  {id: 'alloc-2025-q4', label: 'Q4 2025', from: '2025-10-01', to: '2025-12-31', hours: 7400},
  {id: 'alloc-2026-q1', label: 'Q1 2026', from: '2026-01-01', to: '2026-03-31', hours: 8000},
  {id: 'alloc-2026-q2', label: 'Q2 2026', from: '2026-04-01', to: '2026-06-30', hours: 8400},
  {id: 'alloc-2026-q3', label: 'Q3 2026', from: '2026-07-01', to: '2026-09-30', hours: 7600},
  {id: 'alloc-2026-q4', label: 'Q4 2026', from: '2026-10-01', to: '2026-12-31', hours: 8200}
];
const SHARES = {'person-nadia': 2400, 'person-mei': 2200, 'person-tomas': 1600, 'person-ines': 600};
// Nodes that can fail, by partition. An interruption names a node of the job's partition.
const NODES = {'gpu-h': ['gpu-h-03', 'gpu-h-07', 'gpu-h-11'], 'gpu-a': ['gpu-a-02', 'gpu-a-05'], cpu: ['cpu-14', 'cpu-21']};
const FAILURES = ['CUDA ran out of memory.', 'NaN loss after the warm-up.', 'The data loader lost its shard index.'];
// A reason for an invalidation names what went wrong in the run, not in the config: a config never changes, so a rerun of it fixes only the run.
const INVALIDATIONS = ['The seed read a cached split from the old dataset version.', 'The run used the labels before the fix.', 'The node wrote a corrupt checkpoint, and the run resumed from it.'];
module.exports = {PEOPLE, JOINS, LABMATES, ERAS, FAMILIES, LINES, SPLIT_SHIFT, SUFFIX, CHANGES, SIGN_NOTES, TYPO, CUTS, RAISES, DEADLINES, HOLIDAYS, QUARTERS, SHARES, NODES, FAILURES, INVALIDATIONS};
