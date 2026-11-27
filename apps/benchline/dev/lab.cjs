'use strict';
// The authored lab of the fixtures: the project, its people and partitions, the configs, the first protocol versions and the run plans,
// and small helpers that write the steps of a scripted history for dev/replay.cjs. Used only by the dev scripts, never at run time.
const {at} = require('./replay.cjs');

const ACCOUNT = 'benchline-nadia', OWNER = 'person-nadia';
const PEOPLE = [
  ['person-nadia', 'Nadia Ferrante', 'PhD student'], ['person-okafor', 'Prof. Okafor', 'Lab head'], ['person-mei', 'Mei Lindqvist', 'Postdoc'],
  ['person-tomas', 'Tomas Arce', 'PhD student'], ['person-farid', 'Farid Haddad', 'Research engineer'], ['person-ines', 'Ines Varga', 'Master\'s student']
];
const PARTITIONS = [
  {id: 'gpu-h', name: 'H100 nodes', rate: 2, max_hours: 24},
  {id: 'gpu-a', name: 'A100 nodes', rate: 1, max_hours: 48},
  {id: 'cpu', name: 'CPU nodes', rate: 0, max_hours: 72}
];
// Configs never change. [id, family, version, dataset version, evaluation split, params, code reference, registered by, registered at]
const CONFIGS = [
  ['cfg-mae-b16-v1', 'mae-b16', 1, 'eeg-subjects-2026.1', 'test-subjects', {lr: 0.0005, epochs: 60, mask_ratio: 0.75}, '7d2f01c', 'person-mei', '2026-08-18 10:12'],
  ['cfg-mae-b16-v2', 'mae-b16', 2, 'eeg-subjects-2026.2', 'test-subjects', {lr: 0.0003, epochs: 60, mask_ratio: 0.75}, '9b40e7a', 'person-mei', '2026-10-05 15:40'],
  ['cfg-mae-b16-v3', 'mae-b16', 3, 'eeg-subjects-2026.2', 'test-subjects', {lr: 0.0003, epochs: 80, mask_ratio: 0.8}, 'c13a5d9', 'person-nadia', '2026-11-12 11:05'],
  ['cfg-vit-s16-v1', 'vit-s16', 1, 'eeg-subjects-2026.2', 'test-sessions', {lr: 0.001, epochs: 40, patch: 16}, '52e8b3f', 'person-nadia', '2026-09-02 09:30'],
  ['cfg-vit-s16-v2', 'vit-s16', 2, 'eeg-subjects-2026.2', 'test-subjects', {lr: 0.001, epochs: 40, patch: 16}, '52e8b3f', 'person-nadia', '2026-10-14 13:20'],
  ['cfg-vit-s16-v3', 'vit-s16', 3, 'eeg-subjects-2026.2', 'test-subjects', {lr: 0.0007, epochs: 50, patch: 16}, 'a0c77e2', 'person-tomas', '2026-11-09 16:45'],
  ['cfg-atlas-v1', 'atlas', 1, 'eeg-subjects-2026.2', 'test-subjects', {lr: 0.0002, epochs: 100, depth: 12}, 'e4d1b68', 'person-nadia', '2026-10-20 10:00'],
  ['cfg-atlas-v2', 'atlas', 2, 'eeg-subjects-2026.2', 'test-subjects', {lr: 0.0002, epochs: 120, depth: 12}, 'f09a3c1', 'person-nadia', '2026-11-04 14:10'],
  ['cfg-atlas-v3', 'atlas', 3, 'eeg-subjects-2026.2', 'test-subjects', {lr: 0.00015, epochs: 120, depth: 16}, '1b6e2d4', 'person-tomas', '2026-11-20 09:25'],
  ['cfg-birch-abl-v1', 'birch-abl', 1, 'eeg-subjects-2026.2', 'val-subjects', {lr: 0.0003, epochs: 30, ablate: 'no_mask'}, '3c8f9a0', 'person-nadia', '2026-10-28 17:00'],
  ['cfg-birch-abl-v2', 'birch-abl', 2, 'eeg-subjects-2026.2', 'val-subjects', {lr: 0.0003, epochs: 30, ablate: 'no_pos_embed'}, '3c8f9a0', 'person-nadia', '2026-10-28 17:05'],
  ['cfg-birch-abl-v3', 'birch-abl', 3, 'eeg-subjects-2026.2', 'val-subjects', {lr: 0.0003, epochs: 30, ablate: 'small_decoder'}, '3c8f9a0', 'person-nadia', '2026-10-28 17:10']
];
const ACCURACY = [{name: 'accuracy', direction: 'higher'}];

// The project before the scripted history: the November period and the signed first version of the subject-level protocol.
function base({hardShares = false, maxActive = 3} = {}) {
  const shares = {'person-nadia': 150, 'person-mei': 120, 'person-tomas': 80, 'person-ines': 40};
  const v1At = at('2026-09-08 10:00');
  return {
    account_id: ACCOUNT, owner_person_id: OWNER,
    project: {id: 'proj-okafor-eeg', name: 'Okafor Lab: EEG decoding', cluster: 'Halden research cluster', timezone: 'America/New_York', lab_head_person_id: 'person-okafor',
      policy: {hard_shares: hardShares, max_active_jobs: maxActive, required_signers: ['person-okafor', 'person-nadia'], signoff_window_days: 5}},
    partitions: structuredClone(PARTITIONS),
    people: PEOPLE.map(([person_id, name, role]) => ({person_id, name, role, share_hours: shares[person_id] ?? null})),
    allocation: {period_id: 'alloc-2026-11', label: 'November', starts_at: at('2026-11-01 00:00'), ends_at: at('2026-11-30 23:59:59'), opening_hours: 380, allocation_hours: 380,
      opening_shares: Object.entries(shares).map(([person_id, share_hours]) => ({person_id, share_hours}))},
    past_periods: [{period_id: 'alloc-2026-10', label: 'October', starts_at: at('2026-10-01 00:00'), ends_at: at('2026-10-31 23:59:59'), opening_hours: 360, allocation_hours: 360}],
    allocation_changes: [],
    configs: CONFIGS.map(([id, family, version, dataset_version, eval_split, params, code_ref, registered_by, when]) =>
      ({id, family, version, params, dataset_version, eval_split, code_ref, registered_by, registered_at: at(when), event_id: null})),
    protocols: [{id: 'proto-subj-v1', line: 'subject-eval', version: 1, dataset_version: 'eeg-subjects-2026.2', eval_split: 'test-sessions', metrics: ACCURACY, seeds: [0, 1, 2],
      proposed_by: 'person-okafor', proposed_at: v1At, rationale: 'Held-out sessions of the 2026.2 subjects, three seeds.', respond_by: at('2026-09-13 10:00'), stored_state: 'signed',
      signoffs: [{person_id: 'person-okafor', answer: 'sign', at: v1At, note: null, request_id: null, event_id: null},
        {person_id: 'person-nadia', answer: 'sign', at: at('2026-09-08 15:30'), note: null, request_id: null, event_id: null}],
      signed_at: at('2026-09-08 15:30'), supersedes: null, superseded_at: null, superseded_by: null, declined_at: null, withdrawn_at: null, withdraw_note: null,
      request_id: null, event_id: null, history: []}],
    run_plans: [], jobs: [], tables: [],
    preferences: {timezone: 'America/New_York', email_notices: true, job_end_notices: true},
    notifications: [], activity: []
  };
}

// Steps of a scripted history.
let counter = 0;
const event = (when, name, payload, id) => ({at: at(when), event: name, event_id: id || 'ev-h-' + String(++counter).padStart(4, '0'), payload});
const call = (when, name, args, request_id) => ({at: at(when), call: name, args, ...(request_id ? {request_id} : {})});
const plan = (when, config_id, more) => event(when, 'plan.set', {config_id, ...more});
const recorded = (when, job_id, owner, config_id, seed, partition_id, gpus, limit, starts, ends, end_kind, protocol_id, metrics, id) => event(when, 'job.recorded', {job_id,
  owner_person_id: owner, config_id, seed, partition_id, gpus, time_limit_hours: limit, starts_at: at(starts), ends_at: at(ends), end_kind, protocol_id,
  ...(end_kind === 'completed' ? {metrics} : {})}, id);
const submit = (when, config, seed, partition_id, gpus, limit, protocol_id, more = {}) => call(when, 'jobs.submit', {id: config, seed, partition_id, gpus, time_limit_hours: limit, protocol_id, ...more});
// A new allocation period, as a task loads it: the earlier one becomes history, and the shares open again.
function period(when, period_id, label, starts, ends, hours, shares) {
  return {at: at(when), edit: data => {
    const {opening_shares, ...old} = data.allocation;
    data.past_periods.push(old);
    data.allocation = {period_id, label, starts_at: at(starts), ends_at: at(ends), opening_hours: hours, allocation_hours: hours,
      opening_shares: Object.entries(shares).map(([person_id, share_hours]) => ({person_id, share_hours}))};
    for (const p of data.people) p.share_hours = shares[p.person_id] ?? null;
  }};
}
module.exports = {ACCOUNT, OWNER, PEOPLE, PARTITIONS, CONFIGS, ACCURACY, base, event, call, plan, recorded, submit, period, at};
